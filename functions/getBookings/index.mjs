import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { client } from "../../services/db.mjs";
import { sendResponse } from "../../utils/responses/index.mjs";

export const handler = async (event) => {
  try {
    const getAllBookingsCommand = new QueryCommand({
      TableName: "HotelTable",
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": { S: "BOOKEDROOM" } },
    });

    const result = await client.send(getAllBookingsCommand);
    console.log("RESULTT!:", result);

    return sendResponse(200, {
      message: "hämtade alla bokningar",
      bookings: result.Items,
      success: true,
    });
  } catch (err) {
    return sendResponse(500, {
      message: err.message,
      success: false,
    });
  }
};
