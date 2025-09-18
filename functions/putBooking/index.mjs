import {
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { client } from "../../services/db.mjs";
import { sendResponse } from "../../utils/responses/index.mjs";

const TABLE_NAME = "HotelTable";

export async function handler(event) {
  try {
    const bookingId = event.pathParameters.bookingId;
    // Läser och destrukturerar bokningsdata från request body
    const { checkInDate, checkOutDate, guests, rooms } = JSON.parse(event.body);
    // Validerar att inga fält saknas
    if (
      !bookingId ||
      !checkInDate ||
      !checkOutDate ||
      !guests ||
      !rooms?.length  //checkar att rooms är ett faktiskt värde, t.ex. inte är tom eller inte finns
    ) {
      return sendResponse(400, { message: "Missing data in booking update" });
    }

    // Hämta befintlig bokning
    const getOldBookingCommand = new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: { S: "BOOKEDROOM" },
        sk: { S: `BOOKING#${bookingId}` },
      },
    });

    const oldBookingResponse = await client.send(getOldBookingCommand);
    const oldBooking = oldBookingResponse.Item;

    if (!oldBooking) {
      return sendResponse(404, { message: "Booking not found" });
    }
    const name = oldBooking.name.S;
    const email = oldBooking.email.S;
    const oldRooms = JSON.parse(oldBooking.rooms.S);
    // Räknar ut antal nätter för bokning
    const nights =
      (new Date(checkOutDate) - new Date(checkInDate)) / (1000 * 60 * 60 * 24);
    // Checkar att datumen är giltiga
    if (nights <= 0) {
      return sendResponse(400, { message: "Invalid dates" });
    }

    let totalCapacity = 0;
    let totalPrice = 0;
    const transactItems = []; // Lista med alla transaktioner som ska skickas till DynamoDB

    // Slå ihop gamla och nya rum till en nettouppdatering
    const roomUpdates = {};

    // Lägg tillbaks gamla rum
    for (const room of oldRooms) {
      if (!roomUpdates[room.roomType]) {
        roomUpdates[room.roomType] = 0;
      }
      roomUpdates[room.roomType] += room.count;
    }

    // Dra av nya rum
    for (const room of rooms) {
      if (!roomUpdates[room.roomType]) {
        roomUpdates[room.roomType] = 0;
      }
      roomUpdates[room.roomType] -= room.count;
    }

    // Gå igenom alla unika rumstyper för att hämta info och skapa update
    for (const roomType of Object.keys(roomUpdates)) {
      const countChange = roomUpdates[roomType];

      const getCommand = new GetItemCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: { S: "ROOM" },
          sk: { S: `ROOM#${roomType}` },
        },
      });

      const roomData = await client.send(getCommand);
      const item = roomData.Item;

      if (!item) {
        return sendResponse(400, {
          message: `Room type ${roomType} not found`,
        });
      }
      // Måste parsa oavsett om det är nummer för i DynamoDB lagras allt i strängar
      const available = parseInt(item.quantity.N);
      const pricePerNight = parseInt(item.pricePerNight.N);
      const capacity = parseInt(item.maxGuests.N);

      // Kolla tillgänglighet (bara om vi ska minska)
      const newRoom = rooms.find((r) => r.roomType === roomType);
      const newCount = newRoom?.count || 0;

      if (countChange < 0 && available < Math.abs(countChange)) {
        return sendResponse(400, {
          message: `Not enough ${roomType} rooms. Requested: ${newCount}, Available: ${available}`,
        });
      }

      if (countChange !== 0) {
        const expression = `SET quantity = quantity ${
          countChange > 0 ? "+" : "-"
        } :count`;

        // Uppdaterar och minskar antal tillgängliga rum
        transactItems.push({
          Update: {
            TableName: TABLE_NAME,
            Key: {
              pk: { S: "ROOM" },
              sk: { S: `ROOM#${roomType}` },
            },
            UpdateExpression: expression,
            ConditionExpression:
              countChange < 0 ? "quantity >= :count" : undefined,
            ExpressionAttributeValues: {
              ":count": { N: String(Math.abs(countChange)) },
            },
          },
        });
      }

      // Lägg till kapacitet och pris baserat på NYA rummen
      if (newCount > 0) {
        totalCapacity += capacity * newCount;
        totalPrice += pricePerNight * newCount * nights;
      }
    }

    // Kontrollera kapacitet
    if (totalCapacity < guests) {
      return sendResponse(400, {
        message: `Selected rooms can not accommodate ${guests} guests. Total capacity: ${totalCapacity}`,
      });
    }

    // Uppdatera bokning (med samma bookingId)
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          pk: { S: "BOOKEDROOM" },
          sk: { S: `BOOKING#${bookingId}` },
          name: { S: name },
          email: { S: email },
          checkInDate: { S: checkInDate },
          checkOutDate: { S: checkOutDate },
          guests: { N: String(guests) },
          totalPrice: { N: String(totalPrice) },
          rooms: { S: JSON.stringify(rooms) },
          bookingId: { S: bookingId },
          updatedAt: { S: new Date().toISOString() },
        },
      },
    });

    // Kör hela transaktionen med uppdateringar
    // Antingen lyckas alla eller inga = säker bokning
    await client.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems })
    );

    return sendResponse(200, {
      message: "Booking has been updated",
      bookingId,
      name,
      email,
      guests,
      checkInDate,
      checkOutDate,
      rooms,
      totalPrice,
    });
  } catch (error) {
    console.error("Update booking error:", error);
    
    // Fångar fel beroende på vad som är fel anpassas error message.
    let message = "Internal server error";
    if (error.name === "ConditionalCheckFailedException") {
      message = "One or more room types are no longer available";
    }

    return sendResponse(500, { message });
  }
}
