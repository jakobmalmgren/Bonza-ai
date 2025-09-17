import {
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "eu-north-1" });
const TABLE = process.env.TABLE_NAME || "HotelTable";

const res = (code, obj) => ({ statusCode: code, body: JSON.stringify(obj) });

async function getBookingById(bookingId) {
  const keys = [
    { pk: { S: `BOOKEDROOM#${bookingId}` }, sk: { S: `BOOKING#${bookingId}` } },
    { pk: { S: `BOOKING#${bookingId}` }, sk: { S: `BOOKEDROOM#${bookingId}` } },
  ];
  for (const Key of keys) {
    const { Item } = await client.send(new GetItemCommand({ TableName: TABLE, Key }));
    if (Item) return { Item, Key };
  }

  // Fallback: dev-vänlig Scan på bookingId
  const scan = await client.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: "bookingId = :id",
    ExpressionAttributeValues: { ":id": { S: bookingId } },
  }));
  const item = scan.Items?.[0];
  return item
    ? { Item: item, Key: { pk: { S: item.pk.S }, sk: { S: item.sk.S } } }
    : { Item: null, Key: null };
}

export const handler = async (event) => {
  try {
    const bookingId = event?.pathParameters?.bookingId;
    if (!bookingId) return res(400, { message: "Missing path parameter: bookingId" });

    const { Item, Key } = await getBookingById(bookingId);
    if (!Item) return res(404, { message: "Booking not found" });

    let rooms;
    try { rooms = JSON.parse(Item.rooms?.S ?? "[]"); }
    catch { return res(500, { message: "Corrupt rooms payload" }); }
    if (!Array.isArray(rooms) || rooms.length === 0) {
      return res(500, { message: "Booking missing rooms" });
    }

    // Återställ quantity per rumstyp + radera bokningen i samma transaktion
    const TransactItems = rooms.map(({ roomType, count }) => ({
      Update: {
        TableName: TABLE,
        Key: { pk: { S: "ROOM" }, sk: { S: `ROOM#${roomType}` } },
        UpdateExpression: "SET quantity = quantity + :c",
        ConditionExpression: "attribute_exists(quantity)",
        ExpressionAttributeValues: { ":c": { N: String(count) } },
      },
    }));
    TransactItems.push({
      Delete: {
        TableName: TABLE,
        Key,
        ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
      },
    });

    await client.send(new TransactWriteItemsCommand({ TransactItems }));
    return res(200, { message: "Your booking has been cancelled", bookingId });
  } catch (err) {
    console.error("Delete booking error:", err);
    const message = err.name === "ConditionalCheckFailedException"
      ? "Conditional check failed (availability rows missing or already deleted)"
      : "Internal server error";
    return res(500, { message });
  }
};
