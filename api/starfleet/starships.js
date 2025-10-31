// api/starfleet/starships.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function timeframeMatch(tf) {
  // Accept "all" (or empty) to mean no filter
  if (!tf || tf.toLowerCase() === "all") return {};
  if (tf === "22nd") return { ship_id: { $lt: 400 } };
  if (tf === "23rd") return { ship_id: { $gte: 400, $lt: 2500 } };
  if (tf === "24th") return { ship_id: { $gte: 2500, $lt: 110000 } };
  if (tf === "32nd") return { ship_id: { $gte: 110000 } };
  return {};
}

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();

  // Preflight handled here; CORS headers come from vercel.json
  if (method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const db = await getDb();
    const col = db.collection("starships");

    if (method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, OPTIONS");
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
    }

    const u = new URL(req.url || req.originalUrl || "/", "http://local");
    const id = u.searchParams.get("id");

    // Single doc branch (detail pages)
    if (id) {
      const _id = new ObjectId(String(id));
      const doc = await col.aggregate([
        { $match: { _id } },
        {
          $lookup: {
            from: "photos",
            let: { ownerId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ["$owner", "$$ownerId"] },
                      { $eq: ["$subject_id", "$$ownerId"] } // support either FK field
                    ]
                  }
                }
              },
              { $sort: { created_at: -1, _id: -1 } },
              { $limit: 1 },
              { $project: { _id: 0, url: 1 } }
            ],
            as: "primaryPhoto"
          }
        },
        {
          $addFields: {
            picUrl: {
              $cond: [
                { $gt: [{ $size: "$primaryPhoto" }, 0] },
                [{ $arrayElemAt: ["$primaryPhoto.url", 0] }],
                []
              ]
            }
          }
        },
        { $project: { _id: 1, name: 1, class: 1, registry: 1, ship_id: 1, picUrl: 1 } }
      ]).next();

      if (!doc) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ ok: false, error: "Not Found" }));
      }

      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok: true, ...doc, _id: String(doc._id) }));
    }

    // List / search branch (used by SearchList)
    const name = (u.searchParams.get("name") || "").trim();      // prefix on name
    const klass = (u.searchParams.get("class") || "").trim();    // All / Unknown / exact
    const timeframe = (u.searchParams.get("timeframe") || "").trim(); // 22nd/23rd/24th/32nd or "all"
    const perPage = Math.max(1, Math.min(parseInt(u.searchParams.get("starshipsPerPage") || "12", 10), 200));
    const page = Math.max(0, parseInt(u.searchParams.get("page") || "0", 10));
    const skip = page * perPage;

    // Build filter to match Realm behavior
    const filter = {};
    if (name) {
      filter.name = { $regex: "^" + escRe(name) + ".*", $options: "i" }; // prefix
    }
    if (klass) {
      if (klass === "All") {
        // no-op
      } else if (klass === "Unknown") {
        const unknown = [
          { class: { $exists: false } },
          { class: null },
          { class: "" }
        ];
        if (filter.$or) filter.$or.push(...unknown);
        else filter.$or = unknown;
      } else {
        filter.class = { $regex: "^" + escRe(klass) + "$", $options: "i" }; // exact (ci)
      }
    }
    Object.assign(filter, timeframeMatch(timeframe));

    const total = await col.countDocuments(filter);

    const docs = await col.aggregate([
      { $match: filter },
      { $sort: { ship_id: 1, _id: 1 } },
      { $skip: skip },
      { $limit: perPage },
      {
        $lookup: {
          from: "photos",
          let: { ownerId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ["$owner", "$$ownerId"] },
                    { $eq: ["$subject_id", "$$ownerId"] }
                  ]
                }
              }
            },
            { $sort: { created_at: -1, _id: -1 } },
            { $limit: 1 },
            { $project: { _id: 0, url: 1 } }
          ],
          as: "primaryPhoto"
        }
      },
      {
        $addFields: {
          picUrl: {
            $cond: [
              { $gt: [{ $size: "$primaryPhoto" }, 0] },
              [{ $arrayElemAt: ["$primaryPhoto.url", 0] }],
              []
            ]
          }
        }
      },
      { $project: { _id: 1, name: 1, class: 1, registry: 1, ship_id: 1, picUrl: 1 } }
    ]).toArray();

    const starships = docs.map(d => ({
      ...d,
      _id: String(d._id) // ensure string
    }));

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({
      starships,
      page,
      entries_per_page: perPage,
      total_results: total
    }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: e.message || "Internal error" }));
  }
};
