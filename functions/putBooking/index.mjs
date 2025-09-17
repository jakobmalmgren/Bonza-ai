import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "eu-north-1" });
const TABLE_NAME = "HotelTable";

export async function handler(event) {
  try {
    const bookingId = event.pathParameters.bookingId;

    const {
      checkInDate,
      checkOutDate,
      guests,
      rooms,
    } = JSON.parse(event.body);

    if (!bookingId || !checkInDate || !checkOutDate || !guests || !rooms?.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Missing data in booking update" }),
      };
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
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "Booking not found" }),
      };
    }

    const name = oldBooking.name.S;
    const email = oldBooking.email.S;
    const oldRooms = JSON.parse(oldBooking.rooms.S);

    const nights =
      (new Date(checkOutDate) - new Date(checkInDate)) / (1000 * 60 * 60 * 24);

    if (nights <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Invalid dates" }),
      };
    }

    let totalCapacity = 0;
    let totalPrice = 0;
    const transactItems = [];

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
        return {
          statusCode: 400,
          body: JSON.stringify({ message: `Room type ${roomType} not found` }),
        };
      }

      const available = parseInt(item.quantity.N);
      const pricePerNight = parseInt(item.pricePerNight.N);
      const capacity = parseInt(item.maxGuests.N);

      // Kolla tillgänglighet (bara om vi ska minska)
      const newRoom = rooms.find(r => r.roomType === roomType);
      const newCount = newRoom?.count || 0;

      if (countChange < 0 && available < Math.abs(countChange)) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: `Not enough ${roomType} rooms. Requested: ${newCount}, Available: ${available}`,
          }),
        };
      }

      if (countChange !== 0) {
        const expression = `SET quantity = quantity ${countChange > 0 ? "+" : "-"} :count`;

        transactItems.push({
          Update: {
            TableName: TABLE_NAME,
            Key: {
              pk: { S: "ROOM" },
              sk: { S: `ROOM#${roomType}` },
            },
            UpdateExpression: expression,
            ConditionExpression: countChange < 0 ? "quantity >= :count" : undefined,
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
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: `Selected rooms can not accommodate ${guests} guests. Total capacity: ${totalCapacity}`,
        }),
      };
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

    // Skicka transaktionen
    await client.send(new TransactWriteItemsCommand({ TransactItems: transactItems }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Booking has been updated",
        bookingId,
        name,
        email,
        guests,
        checkInDate,
        checkOutDate,
        rooms,
        totalPrice,
      }),
    };
  } catch (error) {
    console.error("Update booking error:", error);

    let message = "Internal server error";
    if (error.name === "ConditionalCheckFailedException") {
      message = "One or more room types are no longer available";
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ message }),
    };
  }
}
