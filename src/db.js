// src/db.js
const { MongoClient, ServerApiVersion } = require("mongodb");
let client, db;
async function getDb() {
  if (db) return db;
  client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
  });
  await client.connect();
  db = client.db(process.env.MONGODB_DB);
  return db;
}
module.exports = { getDb };
