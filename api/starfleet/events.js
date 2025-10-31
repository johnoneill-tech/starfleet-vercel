// api/starfleet/events.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

function isHex24(s) { return typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s); }
function sortDir(v) { return String(v) === "1" ? 1 : -1; }

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, OPTIONS");
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "Method Not Allowed" }));
  }

  try {
    const db = await getDb();
    const col = db.collection("events");

    const u = new URL(req.url || req.originalUrl || "/", "http://local");
    const category = (u.searchParams.get("category") || "").trim();
    const officer_id = u.searchParams.get("officer_id");
    const starship_id = u.searchParams.get("starship_id");
    const sort = sortDir(u.searchParams.get("sort"));

    // base filter
    const match = {};
    if (category === "Assign-Pro-De") {
      match.type = { $in: ["Assignment", "Promotion", "Demotion"] };
    } else if (category === "Assignment") {
      match.type = "Assignment";
    } else if (category === "Mission") {
      match.type = "Mission";
    } else if (category === "Life Event") {
      match.type = "Life Event";
    }

    if (officer_id) {
      if (isHex24(officer_id)) match.officerId = new ObjectId(officer_id);
      else match.officerId = officer_id; // defensive fallback
    }
    if (starship_id) {
      if (isHex24(starship_id)) match.starshipId = new ObjectId(starship_id);
      else {
        const asNum = Number(starship_id);
        match.$or = [
          { starshipId: starship_id },
          { starship_id: asNum },
          { ship_id: asNum }
        ];
      }
    }

    // Join starship name/registry when a ship is referenced
    const pipeline = [
      { $match: match },
      { $sort: { date: sort, _id: sort } },
      {
        $lookup: {
          from: "starships",
          let: { sid: "$starshipId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$sid"] } } },
            { $project: { _id: 1, name: 1, registry: 1, class: 1, ship_id: 1 } }
          ],
          as: "ship"
        }
      },
      { $addFields: { ship: { $ifNull: [ { $arrayElemAt: ["$ship", 0] }, null ] } } },
      // You can join officer here if you need it in other views
      {
        $project: {
          _id: 1, type: 1, position: 1, date: 1, title: 1, name: 1,
          officerId: 1, starshipId: 1, ship: 1
        }
      }
    ];

    const items = await col.aggregate(pipeline).toArray();

    // ISO-ify dates
    items.forEach(e => { if (e.date) e.date = new Date(e.date).toISOString(); });

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    // Return in a flexible shape (array + keyed field)
    return res.end(JSON.stringify({
      ok: true,
      count: String(items.length),
      events: items,
      items
    }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: e.message || "Internal error" }));
  }
};
