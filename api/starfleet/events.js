// api/starfleet/events.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

// Helpers
function isHex24(s) {
  return typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s);
}
function sortDir(v) {
  // "1" = asc; anything else = desc (preserve prior contract)
  return String(v) === "1" ? 1 : -1;
}

// Optional bundle mapping to mirror legacy keys
const CATEGORY_BUNDLES = {
  "Assign-Pro-De": ["Assignment", "Promotion", "Demotion"],
};

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();

  // CORS preflight (headers are also set in vercel.json; this is safe)
  if (method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, OPTIONS");
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "Method Not Allowed" }));
  }

  try {
    const db = await getDb();
    const col = db.collection("events");

    const u = new URL(req.url, "http://local");
    const categoryParam = (u.searchParams.get("category") || "").trim();
    const sort = sortDir(u.searchParams.get("sort"));
    const page = Number(u.searchParams.get("page") || 0);
    const perPage = Math.min(Number(u.searchParams.get("perPage") || 100), 500);

    // Existing explicit params
    const officer_id  = u.searchParams.get("officer_id");
    const starship_id = u.searchParams.get("starship_id");
    // NEW: polymorphic param supported for legacy frontend usage
    const subject_id  = u.searchParams.get("subject_id");

    // Build match
    const match = {};
    const or = [];

    // Officer filter: accept ObjectId or raw string id
    if (officer_id) {
      if (isHex24(officer_id)) or.push({ officerId: new ObjectId(officer_id) });
      or.push({ officerId: officer_id });
    }

    // Starship filter: accept ObjectId or raw string id
    if (starship_id) {
      if (isHex24(starship_id)) or.push({ starshipId: new ObjectId(starship_id) });
      or.push({ starshipId: starship_id });
    }

    // SUBJECT_ID (polymorphic: could be an officer or a ship)
    if (subject_id) {
      if (isHex24(subject_id)) {
        const oid = new ObjectId(subject_id);
        or.push({ officerId: oid }, { starshipId: oid });
      }
      or.push({ officerId: subject_id }, { starshipId: subject_id });
    }

    if (or.length) match.$or = or;

    // Category handling: bundle key, CSV, or single
    if (categoryParam) {
      let cats = [];
      if (CATEGORY_BUNDLES[categoryParam]) {
        cats = CATEGORY_BUNDLES[categoryParam];
      } else if (categoryParam.includes(",")) {
        cats = categoryParam.split(",").map((s) => s.trim()).filter(Boolean);
      } else {
        cats = [categoryParam];
      }
      if (cats.length) match.category = { $in: cats };
    }

    // Pipeline
    const pipeline = [
      { $match: match },

      // Join starship metadata for UI (name, registry, class, picUrl)
      {
        $lookup: {
          from: "starships",
          localField: "starshipId",
          foreignField: "_id",
          as: "ship",
        },
      },
      { $addFields: { ship: { $arrayElemAt: ["$ship", 0] } } },

      // Normalize fields expected by your VesselsServed UI
      {
        $project: {
          _id: 1,
          officerId: 1,
          starshipId: 1,
          category: 1,
          date: 1,
          title: 1,
          subtitle: 1,
          details: 1,
          tags: 1,
          source: 1,

          // Starship display fields
          name: { $ifNull: ["$ship.name", null] },
          registry: { $ifNull: ["$ship.registry", null] },
          class: { $ifNull: ["$ship.class", null] },
          starshipPicUrl: { $ifNull: ["$ship.picUrl", []] }, // detail endpoints already set picUrl: string[]
        },
      },

      // Sort & paginate
      { $sort: { date: sort, _id: sort } },
      { $skip: page * perPage },
      { $limit: perPage },
    ];

    const items = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // IMPORTANT: return a *bare array* so response.data is an array on the frontend
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(items));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: e.message || "Internal error" }));
  }
};
