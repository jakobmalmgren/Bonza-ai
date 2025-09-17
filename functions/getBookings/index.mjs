import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { client } from "../../services/db.mjs";

export const handler = async (event) => {
  try {
    const getAllBookingsCommand = new QueryCommand({
      TableName: "HotelTable",
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": { S: "BOOKEDROOM" } },
    });

    const result = await client.send(getAllBookingsCommand);
    console.log("RESULTT!:", result);

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: "hämtade alla bokningar",
          bookings: result.Items,
          success: true,
        },
        null,
        2
      ),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: err.message,
        success: false,
      }),
    };
  }
};

// Följande ska man kunna se om varje bokning:

// Bokningsnummer
// In-och utcheckningsdatum
// Antal gäster
// Antalet rum
// Namn på den som bokade rummet
