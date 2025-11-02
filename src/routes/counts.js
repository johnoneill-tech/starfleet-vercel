// api/starfleet/counts.js
const { getDb } = require("../db");

module.exports = async (req, res) => {
  try {
    const method = (req.method || "GET").toUpperCase();

    // Respond to preflight quickly; vercel.json will attach headers
    if (method === "OPTIONS") {
      res.statusCode = 204; // No Content
      return res.end();
    }

    if (method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, OPTIONS");
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
    }

    // Read query
    let categoryParam = "starships";
    try {
      const u = new URL(req.url || req.originalUrl || "/", "http://local");
      categoryParam = (u.searchParams.get("category") || "starships").trim();
    } catch {}

    // Realm behavior: "personnel" → "officers"
    const category = categoryParam === "personnel" ? "officers" : categoryParam;

    const db = await getDb();
    const col = db.collection(category);

    // API v1 strict–friendly
    const count = await col.countDocuments({});

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ count: String(count) }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: e.message || "Internal error" }));
  }
};
