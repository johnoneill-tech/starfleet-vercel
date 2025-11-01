// api/starfleet/admin/seed-user.js
// One-time user seeder. Call once, then delete this file.
// Auth: require header X-Seed-Secret to match process.env.SEED_SECRET

const { getDb } = require("../../../src/db");
const { ObjectId } = require("bson");
const passwordHash = require("password-hash"); // ensure this dep is installed

function write(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  const secret = req.headers["x-seed-secret"];
  if (!process.env.SEED_SECRET || secret !== process.env.SEED_SECRET) {
    return write(res, 401, { ok: false, error: "unauthorized" });
  }

  // Customize these if you want
  const email = (req.query.email || "test@starfleet.local").toString().toLowerCase();
  const name = (req.query.name || "Test Admin").toString();
  const plain = (req.query.password || "startrek123").toString();
  const isAdmin = (req.query.admin || "true").toString().toLowerCase() !== "false";

  try {
    const db = await getDb();
    const users = db.collection("users");

    const existing = await users.findOne({ email });
    if (existing) {
      return write(res, 200, {
        ok: true,
        created: false,
        id: existing._id.toString(),
        email,
        note: "User already exists",
      });
    }

    const hashed = passwordHash.generate(plain);
    const doc = {
      _id: new ObjectId(),
      name,
      email,
      password: hashed,
      admin: !!isAdmin,
      tokens: [],
    };
    await users.insertOne(doc);

    return write(res, 200, {
      ok: true,
      created: true,
      id: doc._id.toString(),
      email,
      password_hint: plain.slice(0, 2) + "…" + plain.slice(-2), // avoid echoing full password
    });
  } catch (e) {
    return write(res, 500, { ok: false, error: e.message || "seed failed" });
  }
};
