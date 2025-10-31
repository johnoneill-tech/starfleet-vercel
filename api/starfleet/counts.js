// api/starfleet/counts.js
const { getDb } = require("../../src/db");
const { setCors, handlePreflight } = require("../../src/cors"); // optional, if you added cors.js

module.exports = async (req, res) => {
  if (handlePreflight && handlePreflight(req, res)) return; // for OPTIONS preflight

  try {
    if (setCors) setCors(res);

    const url = new URL(req.url, "http://localhost");
    const categoryParam = url.searchParams.get("category") || "starships";

    // Match Realm behavior: if category = personnel → use "officers"
    const category = categoryParam === "personnel" ? "officers" : categoryParam;

    const db = await getDb();
    const col = db.collection(category);

    const count = await col.countDocuments();
    return res
      .status(200)
      .json({ ok: true, category, count: count.toString() });
  } catch (e) {
    console.error("counts error:", e);
    return res
      .status(500)
      .json({ ok: false, error: e.message || "Internal error" });
  }
};
