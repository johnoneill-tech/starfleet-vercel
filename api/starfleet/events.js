// api/starfleet/events.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

// Helpers
function isHex24(s) {
  return typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s);
}
function asOid(v) {
  try { return new ObjectId(v); } catch { return null; }
}
function sortDir(v) {
  // "1" = asc, anything else = desc (preserve your existing contract)
  return String(v) === "1" ? 1 : -1;
}

// Optional category bundle map to mirror legacy keys
// "Assign-Pro-De" groups Assignment/Promotion/Demotion exactly like your old pipeline.
const CATEGORY_BUNDLES = {
  "Assign-Pro-De": ["Assignment", "Promotion", "Demotion"],
};

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();

  // Preflight
  if (method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  // Only GET supported (per your current handler)
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
    // NEW: polymorphic param (legacy frontend uses this)
    const subject_id  = u.searchParams.get("subject_id");

    // Build match
    const match = {};
    const or = [];

    // Officer filter (accept ObjectId or string — your docs permit both)
    if (officer_id) {
      if (isHex24(officer_id)) or.push({ officerId: new ObjectId(officer_id) });
      or.push({ officerId: officer_id });
    }

    // Starship filter
    if (starship_id) {
      if (isHex24(starship_id)) or.push({ starshipId: new ObjectId(starship_id) });
      or.push({ starshipId: starship_id });
    }

    // SUBJECT_ID support (either officer or ship). This is what your old UI passes.
    if (subject_id) {
      if (isHex24(subject_id)) {
        const oid = new ObjectId(subject_id);
        or.push({ officerId: oid }, { starshipId: oid });
      }
      // also match as raw string for safety
      or.push({ officerId: subject_id }, { starshipId: subject_id });
    }

    if (or.length) match.$or = or;

    // Category handling (single, CSV, or bundle like "Assign-Pro-De")
    if (categoryParam) {
      let cats = [];
      if (CATEGORY_BUNDLES[categoryParam]) {
        cats = CATEGORY_BUNDLES[categoryParam];
      } else if (categoryParam.includes(",")) {
        cats = categoryParam.split(",").map(s => s.trim()).filter(Boolean);
      } else {
        cats = [categoryParam];
      }
      if (cats.length) match.category = { $in: cats };
    }

    // Pipeline
    const pipeline = [
      { $match: match },

      // Optional join: starship meta (name, registry, class, picUrl)
      {
        $lookup: {
          from: "starships",
          localField: "starshipId",
          foreignField: "_id",
          as: "ship",
        }
      },
      { $addFields: { ship: { $arrayElemAt: ["$ship", 0] } } },

      // Normalize a couple of fields for the UI (tolerant projection)
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

          // Starship display fields expected by the UI component
          name: { $ifNull: ["$ship.name", null] },
          registry: { $ifNull: ["$ship.registry", null] },
          class: { $ifNull: ["$ship.class", null] },
          starshipPicUrl: { $ifNull: ["$ship.picUrl", []] }, // detail routes already make picUrl: string[]
        }
      },

      // Sort by date, then _id for stability
      { $sort: { date: sort, _id: sort } },

      // Pagination facet
      {
        $facet: {
          items: [
            { $skip: page * perPage },
            { $limit: perPage },
          ],
          total: [{ $count: "n" }],
        }
      }
    ];

    const [agg] = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
    const items = agg?.items || [];
    const total = agg?.total?.[0]?.n || 0;

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");

    // IMPORTANT:
    // If the caller used `subject_id` (legacy polymorphic param),
    // return a *bare array* to preserve the old frontend contract:
    if (subject_id) {
      return res.end(JSON.stringify(items));
    }

    // Otherwise keep the wrapper you had: { ok, count, events, items }
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
