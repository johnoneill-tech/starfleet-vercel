// api/starfleet/classes.js
const { getDb } = require("../../src/db");

module.exports = async (req, res) => {
  try {
    if ((req.method || "GET").toUpperCase() !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
    }

    // Parse query (no Express here)
    let search = "";
    try {
      const u = new URL(req.url || req.originalUrl || "/", "http://local");
      search = (u.searchParams.get("search") || "").trim();
    } catch {}

    const db = await getDb();
    const col = db.collection("starships");

    const filter = search
      ? { class: { $type: "string", $ne: "", $regex: `^${search}.*`, $options: "i" } }
      : { class: { $type: "string", $ne: "" } };

    const classes = await col.distinct("class", filter);
    classes.sort((a, b) => a.localeCompare(b));

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(classes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: e.message }));
  }
};
