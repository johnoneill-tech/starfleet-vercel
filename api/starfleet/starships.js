// api/starfleet/starships.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function isHex24(s) { return typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s); }
function timeframeMatch(tf) {
  if (!tf || tf.toLowerCase() === "all") return {};
  if (tf === "22nd") return { ship_id: { $lt: 400 } };
  if (tf === "23rd") return { ship_id: { $gte: 400, $lt: 2500 } };
  if (tf === "24th") return { ship_id: { $gte: 2500, $lt: 110000 } };
  if (tf === "32nd") return { ship_id: { $gte: 110000 } };
  return {};
}

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") { res.statusCode = 204; return res.end(); }

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

    // ---------- DETAIL BRANCH ----------
    if (id) {
      // Tolerant id match: _id (ObjectId), starship_id (number/string), or string _id
      const or = [];
      if (isHex24(id)) or.push({ _id: new ObjectId(id) });
      const numId = Number(id);
      if (!Number.isNaN(numId)) or.push({ ship_id: numId }, { starship_id: numId });
      or.push({ _id: id });

      const doc = await col.aggregate([
        { $match: { $or: or } },

        // Primary photo
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

        // Crew assignments joined to officers
        {
          $lookup: {
            from: "assignments",
            let: { shipId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ["$starship_id", "$$shipId"] },
                      { $eq: ["$ship_id", "$$shipId"] }
                    ]
                  }
                }
              },
              { $sort: { from_date: -1, _id: -1 } },
              { $limit: 200 },
              {
                $lookup: {
                  from: "officers",
                  let: { personRef: "$personnel_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $or: [
                            { $eq: ["$_id", "$$personRef"] },
                            { $eq: ["$officer_id", "$$personRef"] }
                          ]
                        }
                      }
                    },
                    { $project: { _id: 1, first: 1, middle: 1, surname: 1, name: 1, rank: 1, division: 1 } }
                  ],
                  as: "person"
                }
              },
              { $addFields: { person: { $ifNull: [ { $arrayElemAt: ["$person", 0] }, null ] } } },
              { $project: { _id: 1, role: 1, from_date: 1, to_date: 1, person: 1 } }
            ],
            as: "crewAssignments"
          }
        },

        // Current crew & count
        {
          $addFields: {
            currentCrew: {
              $filter: {
                input: "$crewAssignments",
                as: "a",
                cond: { $or: [ { $eq: ["$$a.to_date", null] }, { $not: ["$$a.to_date"] } ] }
              }
            },
            currentCrewCount: {
              $size: {
                $filter: {
                  input: "$crewAssignments",
                  as: "a",
                  cond: { $or: [ { $eq: ["$$a.to_date", null] }, { $not: ["$$a.to_date"] } ] }
                }
              }
            }
          }
        },

        // Recent events
        {
          $lookup: {
            from: "events",
            let: { shipId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ["$starship_id", "$$shipId"] },
                      { $in: ["$$shipId", { $ifNull: ["$ships", []] }] },
                      { $in: ["$$shipId", { $ifNull: ["$subjects", []] }] }
                    ]
                  }
                }
              },
              { $sort: { date: -1, _id: -1 } },
              { $limit: 10 },
              { $project: { _id: 1, name: 1, title: 1, date: 1, type: 1 } }
            ],
            as: "recentEvents"
          }
        },

        // Normalize picUrl & final projection
        {
          $addFields: {
            picUrl: {
              $cond: [
                { $gt: [ { $size: "$primaryPhoto" }, 0 ] },
                [ { $arrayElemAt: ["$primaryPhoto.url", 0] } ],
                []
              ]
            }
          }
        },
        { $project: { _id: 1, name: 1, class: 1, registry: 1, ship_id: 1, picUrl: 1,
                      crewAssignments: 1, currentCrew: 1, currentCrewCount: 1, recentEvents: 1 } }
      ]).next();

      if (!doc) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ ok: false, error: "Not Found" }));
      }

      const out = { ...doc, _id: String(doc._id) };
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok: true, ...out }));
    }
    // ---------- END DETAIL BRANCH ----------

    // ---------- LIST / SEARCH (legacy envelope) ----------
    const name = (u.searchParams.get("name") || "").trim();
    const klass = (u.searchParams.get("class") || "").trim();
    const timeframe = (u.searchParams.get("timeframe") || "").trim();
    const perPage = Math.max(1, Math.min(parseInt(u.searchParams.get("starshipsPerPage") || "12", 10), 200));
    const page = Math.max(0, parseInt(u.searchParams.get("page") || "0", 10));
    const skip = page * perPage;

    const filter = {};
    if (name) filter.name = { $regex: "^" + escRe(name) + ".*", $options: "i" };
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
        filter.class = { $regex: "^" + escRe(klass) + "$", $options: "i" };
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

    const starships = docs.map(d => ({ ...d, _id: String(d._id) }));
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({
      starships,
      page,
      entries_per_page: perPage,
      total_results: total
    }));
    // ---------- END LIST BRANCH ----------
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: e.message || "Internal error", debug: "starships detail/list pipeline" }));
  }
};
