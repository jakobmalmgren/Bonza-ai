import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import fs from "fs";

// Läs JSON-filen
const raw = fs.readFileSync("rooms.json", "utf-8");
const rooms = JSON.parse(raw);

const client = new DynamoDBClient({ region: "eu-north-1" });
const TABLE_NAME = "HotelTable";

const seedRooms = async () => {
  for (const room of rooms) {
    const command = new PutItemCommand({
      TableName: TABLE_NAME,
      Item: room
    });

    try {
      await client.send(command);
      console.log(`Lagt in: ${room.roomType.S}`);
    } catch (err) {
      console.error("Fel vid uppladdning:", err);
    }
  }
};

seedRooms();