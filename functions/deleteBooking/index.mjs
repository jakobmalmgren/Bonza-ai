import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "eu-north-1" });
const TABLE_NAME = "HotelTable";

export async function handler(event) {
  try {
    const id = event.pathParameters?.bookingId;
    if (!id) return { statusCode: 400, body: JSON.stringify({ message: "Missing bookingId" }) };

    const { Item } = await client.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: { pk: { S: "BOOKEDROOM" }, sk: { S: `BOOKING#${id}` } },
    }));
    if (!Item) return { statusCode: 404, body: JSON.stringify({ message: "Booking not found" }) };

    const byType = JSON.parse(Item.rooms.S).reduce((m, { roomType, count }) => {
      m[roomType] = (m[roomType] || 0) + Number(count || 0); return m;
    }, {});

    const TransactItems = [
      ...Object.entries(byType).map(([type, cnt]) => ({
        Update: {
          TableName: TABLE_NAME,
          Key: { pk: { S: "ROOM" }, sk: { S: `ROOM#${type}` } },
          UpdateExpression: "ADD quantity :c",
          ExpressionAttributeValues: { ":c": { N: String(cnt) } },
        },
      })),
      { Delete: { TableName: TABLE_NAME, Key: { pk: { S: "BOOKEDROOM" }, sk: { S: `BOOKING#${id}` } } } },
    ];

    await client.send(new TransactWriteItemsCommand({ TransactItems }));
    return { statusCode: 200, body: JSON.stringify({ message: "Your booking has been cancelled" }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ message: "Internal server error", error: error.message }) };
  }
}