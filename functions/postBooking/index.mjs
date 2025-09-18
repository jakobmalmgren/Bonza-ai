import {
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { client } from "../../services/db.mjs";
import { sendResponse } from "../../utils/responses/index.mjs";

const TABLE_NAME = "HotelTable";

export async function handler(event) {
  try {
    // Läser och destrukturerar bokningsdata från request body
    const { name, email, checkInDate, checkOutDate, guests, rooms } =
      JSON.parse(event.body);
    // Validerar att inga fält saknas
    if (
      !name ||
      !email ||
      !checkInDate ||
      !checkOutDate ||
      !guests ||
      !rooms?.length //checkar att rooms är ett faktiskt värde, t.ex. inte är tom eller inte finns
    ) {
      return sendResponse(400, { message: "Missing data in booking" });
    }
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
    // Går igenom varje rumstyp användaren försöker boka
    for (const room of rooms) {
      const { roomType, count } = room;
      //  Validerar rumstyp och antal
      if (!roomType || count <= 0) {
        return sendResponse(400, {
          message: `Invalid roomType or count: ${roomType}`,
        });
      }

      // Hämtar info om rum från DynamoDB
      const getCommand = new GetItemCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: { S: "ROOM" },
          sk: { S: `ROOM#${roomType}` },
        },
      });

      const roomData = await client.send(getCommand);
      const item = roomData.Item;
      // Kontroll om rumstypen existerar
      if (!item) {
        return sendResponse(400, {
          message: `Could not find room type: ${roomType}`,
        });
      }
      // Måste parsa oavsett om det är nummer för i DynamoDB lagras allt i strängar
      const available = parseInt(item.quantity.N);
      const pricePerNight = parseInt(item.pricePerNight.N);
      const capacity = parseInt(item.maxGuests.N);
      // Kontrollerar om tillräckligt många rum finns
      if (available < count) {
        return sendResponse(400, {
          message: `Not enough ${roomType} rooms. Requested: ${count}, Available: ${available}`,
        });
      }
      // Uppdaterar totala värden för kapacitet och pris
      totalCapacity += capacity * count;
      totalPrice += pricePerNight * count * nights;

      // Uppdaterar och minskar antal tillgängliga rum
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: { S: "ROOM" },
            sk: { S: `ROOM#${roomType}` },
          },
          UpdateExpression: "SET quantity = quantity - :count",
          ConditionExpression: "quantity >= :count",
          ExpressionAttributeValues: {
            ":count": { N: String(count) },
          },
        },
      });
    }

    // Kontroll av antal gäster mot kapacitet
    if (totalCapacity < guests) {
      return sendResponse(400, {
        message: `Selected rooms can not accomodate ${guests} guests. Total capacity: ${totalCapacity}`,
      });
    }
    // Skapar unikt boknings-ID
    const bookingId = uuidv4();

    // Lägger till bokningen i transaktionen
    transactItems.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          pk: { S: `BOOKEDROOM` },
          sk: { S: `BOOKING#${bookingId}` },
          name: { S: name },
          email: { S: email },
          checkInDate: { S: checkInDate },
          checkOutDate: { S: checkOutDate },
          guests: { N: String(guests) },
          totalPrice: { N: String(totalPrice) },
          rooms: { S: JSON.stringify(rooms) },
          bookingId: { S: bookingId },
          createdAt: { S: new Date().toISOString() },
        },
      },
    });
    // Kör hela transaktionen med uppdateringar
    // Antingen lyckas alla eller inga = säker bokning
    await client.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems })
    );

    return sendResponse(201, {
      message: "Booking has been confirmed",
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
    console.error("Booking error:", error);

    // Fångar fel beroende på vad som är fel anpassas error message.
    let message = "Internal server error";
    if (error.name === "ConditionalCheckFailedException") {
      message = "One or more room types are already fully booked";
    }

    return sendResponse(500, { message });
  }
}
