// seed_test_user.js
// Creates a test admin user in your StarfleetDatabase.users collection

const { MongoClient, ObjectId } = require("mongodb");
const passwordHash = require("password-hash"); // npm i password-hash

// ⚙️ Update this for your setup
const MONGO_URI = process.env.MONGO_URI || "your_mongodb_connection_string_here";
const DB_NAME = "StarfleetDatabase";

async function run() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const users = db.collection("users");

    const email = "test@starfleet.local";
    const passwordPlain = "startrek123";
    const name = "Test Admin";
    const hashed = passwordHash.generate(passwordPlain);

    const existing = await users.findOne({ email });
    if (existing) {
      console.log(`✅ Test user already exists: ${email}`);
      console.log("You can log in with:");
      console.log(`Email: ${email}`);
      console.log(`Password: ${passwordPlain}`);
      return;
    }

    const doc = {
      _id: new ObjectId(),
      name,
      email,
      password: hashed,
      admin: true,
      tokens: [],
    };

    await users.insertOne(doc);
    console.log(`✅ Created test user: ${email}`);
    console.log(`Login credentials:`);
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${passwordPlain}`);
  } catch (err) {
    console.error("❌ Error creating test user:", err);
  } finally {
    await client.close();
  }
}

run();
