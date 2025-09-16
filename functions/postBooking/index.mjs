import { v4 as uuidv4 } from "uuid";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { client } from "../../services/db.mjs";

export const handler = async (event) => {
  try {
    //   1.kolla så allt i bodyn är med  :
    // Antal gäster
    // Vilka rumstyper och antal
    // Datum för in-och utcheckning
    // Namn och
    // e-postaddress på den som bokar
    const body = JSON.parse(event.body);
    const { name, email, guests, checkIn, checkOut, roomType } = body;
    if (!name || !email || !guests || !checkIn || !checkOut || !roomType) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: " du har inte all data som krävs i body",
          success: false,
        }),
      };
    }
    // 2.finns de rummen man efterfrågar??
    const requestedRoomTypes = roomType;
    const failed = [];
    for (const room of requestedRoomTypes) {
      const { type, quantity } = room;
      const sk = `ROOM#${type}`;
      const command = new QueryCommand({
        TableName: "HotelTable",
        KeyConditionExpression: "pk = :pk AND sk = :sk",
        ExpressionAttributeValues: {
          ":pk": { S: "ROOM" },
          ":sk": { S: sk },
        },
      });
      const result = await client.send(command);
      const item = result.Items?.[0];

      if (!item) {
        failed.push({ type, success: false, reason: `rummet finns inte!` });
      } else {
        const available = parseInt(item.quantity.N);
        if (available < quantity)
          failed.push({
            type,
            success: false,
            reason: `Endast ${available} tillgängliga`,
          });
      }
    }

    if (failed.length > 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Några rum saknas eller har för låg tillgänglighet",
          failed,
          success: false,
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Alla önskade rum finns tillgängliga",
        success: true,
        guest: {
          name: body.name,
          email: body.email,
          guests: body.guests,
          checkIn: body.checkIn,
          checkOut: body.checkOut,
        },
        rooms: requestedRoomTypes,
      }),
    };

    // 3. logik för at se om totala antal personer går ihop med rummen, räkna ut antal
    // nätter för rummen och pris så totala, sen dra ifrån de rummen man boka från DB
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: err.message,
        success: false,
      }),
    };
  }
};
