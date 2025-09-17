import { v4 as uuidv4 } from "uuid";
import {
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { client } from "../../services/db.mjs";

export const handler = async (event) => {
  try {
    // 1. Kolla så allt i body finns med:
    const body = JSON.parse(event.body);
    const { name, email, guests, checkIn, checkOut, roomType } = body;
    if (!name || !email || !guests || !checkIn || !checkOut || !roomType) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Du har inte all data som krävs i body",
          success: false,
        }),
      };
    }
    let totalBeds = 0;
    const failed = [];
    const bookingId = uuidv4();
    let totalCost = 0;
    const totalDays = Math.ceil(
      (new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)
    );

    // 2. Finns rummen och har tillräckligt antal?
    // ex här så loopar man o tar vilka rum som lagts till i bodyn hos frontend

    for (const room of roomType) {
      const { type, quantity } = room;
      const sk = `ROOM#${type}`;
      const command = new GetItemCommand({
        TableName: "HotelTable",
        Key: {
          pk: { S: "ROOM" },
          sk: { S: sk },
        },
      });
      const result = await client.send(command);
      const item = result.Item;

      if (!item) {
        failed.push({ type, success: false, reason: "Rummet finns inte!" });
      } else {
        const available = parseInt(item.quantity.N, 10);
        if (available < quantity) {
          failed.push({
            type,
            success: false,
            reason: `Endast ${available} tillgängliga`,
          });
        }
        // 3. Räkna totala sängar och kontrollera att det räcker för gästerna
        const bedsPerRoom = parseInt(item.maxGuests.N, 10);
        totalBeds += bedsPerRoom * quantity;

        // 4. Beräkna total kostnad
        const pricePerNight = parseFloat(item.pricePerNight.N);
        const costForThisRoomType = pricePerNight * totalDays * quantity;
        totalCost += costForThisRoomType;
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

    if (totalBeds < guests) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: `Totalt antal sängar (${totalBeds}) räcker inte för ${guests} gäster.`,
          success: false,
        }),
      };
    }

    // 5. Spara bokningen
    const putItemObj = {
      pk: { S: "BOOKEDROOM" },
      sk: { S: `BOOKING#${bookingId}` },
      name: { S: name },
      email: { S: email },
      guests: { N: guests.toString() },
      checkIn: { S: checkIn },
      checkOut: { S: checkOut },
      totalCost: { N: totalCost.toString() },
      roomType: { S: JSON.stringify(roomType) },
      createdAt: { S: new Date().toISOString() },
    };

    const putCommand = new PutItemCommand({
      TableName: "HotelTable",
      Item: putItemObj,
    });

    await client.send(putCommand);

    // 6. Uppdatera antal tillgängliga rum
    for (const room of roomType) {
      const { type, quantity } = room;
      const sk = `ROOM#${type}`;

      const updateCommand = new UpdateItemCommand({
        TableName: "HotelTable",
        Key: {
          pk: { S: "ROOM" },
          sk: { S: sk },
        },
        UpdateExpression: "SET quantity = quantity - :qty",
        ExpressionAttributeValues: {
          ":qty": { N: quantity.toString() },
        },
        ConditionExpression: "quantity >= :qty",
      });
      await client.send(updateCommand);
    }

    // 7. Hämta sparad bokning för svar
    const getItemCommand = new GetItemCommand({
      TableName: "HotelTable",
      Key: {
        pk: { S: "BOOKEDROOM" },
        sk: { S: `BOOKING#${bookingId}` },
      },
    });
    const savedBooking = await client.send(getItemCommand);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Bokat!",
        data: savedBooking.Item,
        success: true,
      }),
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
