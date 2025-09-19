import {
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";

import { client } from "../../services/db.mjs";
import { sendResponse } from "../../utils/responses/index.mjs";

const TABLE_NAME = "HotelTable";

export async function handler(event) {
  try {
    const id = event.pathParameters?.bookingId;
    if (!id) {
      return sendResponse(400, { message: "Missing bookingId" });
    }
    // Hämtar bokningen
    const { Item } = await client.send(
      new GetItemCommand({
        TableName: TABLE_NAME,
        Key: { pk: { S: "BOOKEDROOM" }, sk: { S: `BOOKING#${id}` } },
      })
    );
    if (!Item) {
      return sendResponse(404, { message: "Booking not found" });
    }
    // Plockar ut rummen från bokningen och summerar hur många rum som bokats per typ
    const byType = JSON.parse(Item.rooms.S).reduce((m, { roomType, count }) => {
      // Summerar rum per typ: t.ex. { "single": 2, "double": 1 }
      m[roomType] = (m[roomType] || 0) + Number(count || 0);
      return m;
    }, {});
    // Lägger tillbaka rummen (qauntity)
    const TransactItems = [
      ...Object.entries(byType).map(([type, cnt]) => ({
        Update: {
          TableName: TABLE_NAME,
          Key: { pk: { S: "ROOM" }, sk: { S: `ROOM#${type}` } },
          // Ökar antalet tillgängliga rum av den typen
          UpdateExpression: "ADD quantity :c",
          ExpressionAttributeValues: { ":c": { N: String(cnt) } },
        },
      })),
      { // Tar bort bokning
        Delete: {
          TableName: TABLE_NAME,
          Key: { pk: { S: "BOOKEDROOM" }, sk: { S: `BOOKING#${id}` } },
        },
      },
    ];
    // Skickar transaktion till DynamoDB med uppdatering och delete
    await client.send(new TransactWriteItemsCommand({ TransactItems }));

    return sendResponse(200, { message: "Your booking has been cancelled" });
  } catch (error) {
    // Fångar eventuella fel och skickar tillbaka ett felmeddelande
    return sendResponse(500, {
      message: "Internal server error",
      error: error.message,
    });
  }
}
