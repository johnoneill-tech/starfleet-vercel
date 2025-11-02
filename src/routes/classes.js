// api/starfleet/classes.js
const { getDb } = require("../db");

module.exports = async (req, res) => {
  try {
    if ((req.method || "GET").toUpperCase() !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
    }

    // Read ?search= from the URL (no Express)
    let search = "";
    try {
      const u = new URL(req.url || req.originalUrl || "/", "http://local");
      search = (u.searchParams.get("search") || "").trim();
    } catch {}

    const db = await getDb();
    const col = db.collection("starships");

    // Build API-v1-friendly aggregation (no `distinct` command)
    const match = search
      ? { class: { $type: "string", $ne: "", $regex: `^${search}`, $options: "i" } }
      : { class: { $type: "string", $ne: "" } };

    const pipeline = [
      { $match: match },
      { $group: { _id: "$class" } },
      { $project: { _id: 0, class: "$_id" } },
      { $sort: { class: 1 } }
    ];

    const docs = await col.aggregate(pipeline, { allowDiskUse: false }).toArray();
    const classes = docs.map(d => d.class).filter(Boolean);

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(classes));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: e.message }));
  }
};
