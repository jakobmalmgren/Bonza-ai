import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from "uuid";

const client = new DynamoDBClient({ region: "eu-north-1" })
const TABLE_NAME = "HotelTable"

export async function handler(event) {
  try {
    const {
      name,
      email,
      checkInDate,
      checkOutDate,
      guests,
      rooms,
    } = JSON.parse(event.body)

    if (!name || !email || !checkInDate || !checkOutDate || !guests || !rooms?.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Missing data in booking"}),
      }
    }

    const nights =
      (new Date(checkOutDate) - new Date(checkInDate)) / (1000 * 60 * 60 * 24)

    if (nights <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Invalid dates" }),
      }
    }

    let totalCapacity = 0
    let totalPrice = 0
    const transactItems = []

    for (const room of rooms) {
      const { roomType, count } = room

      if (!roomType || count <= 0) {
        return {
          statusCode: 400,
          body: JSON.stringify({ message: `Invalid roomType or count: ${roomType}` }),
        }
      }

      // Hämtar info om rum från DynamoDB
      const getCommand = new GetItemCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: { S: "ROOM" },
          sk: { S: `ROOM#${roomType}` },
        },
      })

      const roomData = await client.send(getCommand)
      const item = roomData.Item

      if (!item) {
        return {
          statusCode: 400,
          body: JSON.stringify({ message: `Could not find room type: ${roomType}` }),
        }
      }

      const available = parseInt(item.quantity.N)
      const pricePerNight = parseInt(item.pricePerNight.N)
      const capacity = parseInt(item.maxGuests.N)

      if (available < count) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: `Not enough ${roomType} rooms. Requested: ${count}, Available: ${available}`,
          }),
        }
      }

      totalCapacity += capacity * count
      totalPrice += pricePerNight * count * nights

      // Uppdaterar och minskar tillgängliga rum
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
      })
    }

    // Kontroll av antal gäster mot kapacitet
    if (totalCapacity < guests) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: `Selected rooms can not accomodate ${guests} guests. Total capacity: ${totalCapacity}`,
        }),
      }
    }

    const bookingId = uuidv4()

    // Lägger till bokningen
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
    })
    // Kör hela transaktionen med uppdateringar
    // Antingen lyckas alla eller inga = säker bokning
    await client.send(new TransactWriteItemsCommand({ TransactItems: transactItems }))

    return {
      statusCode: 201,
      body: JSON.stringify({
        message: "Booking has been confirmed",
        bookingId,
        name,
        email,
        guests,
        checkInDate,
        checkOutDate,
        rooms,
        totalPrice,
      }),
    }
  } catch (error) {
    console.error("Booking error:", error)

    let message = "Internal server error"
    if (error.name === "ConditionalCheckFailedException") {
      message = "One or more room types are already fully booked"
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ message },)
    }
  }
}
