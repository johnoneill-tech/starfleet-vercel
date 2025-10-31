// api/starfleet/personnel.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function isHex24(s) { return typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s); }

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  try {
    const db = await getDb();
    const col = db.collection("officers");

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
      // Build a tolerant match: try _id (ObjectId), personnel_id (ObjectId), or string _id
      const or = [];
      if (isHex24(id)) {
        const oid = new ObjectId(id);
        or.push({ _id: oid }, { personnel_id: oid });
      }
      // also allow plain-string _id (in case of string ids)
      or.push({ _id: id });

      const doc = await col.aggregate([
        { $match: { $or: or } },

        // Primary photo (owner or subject_id)
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

        // Assignments joined to starships
        {
          $lookup: {
            from: "assignments",
            let: { personId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ["$personnel_id", "$$personId"] },
                      { $eq: ["$officer_id", "$$personId"] }
                    ]
                  }
                }
              },
              { $sort: { from_date: -1, _id: -1 } },
              { $limit: 50 },
              {
                $lookup: {
                  from: "starships",
                  let: { shipRef: "$starship_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $or: [
                            { $eq: ["$_id", "$$shipRef"] },        // ObjectId FK
                            { $eq: ["$starship_id", "$$shipRef"] } // numeric/string FK
                          ]
                        }
                      }
                    },
                    { $project: { _id: 1, name: 1, registry: 1, class: 1, ship_id: 1 } }
                  ],
                  as: "ship"
                }
              },
              { $addFields: { ship: { $ifNull: [ { $arrayElemAt: ["$ship", 0] }, null ] } } },
              { $project: { _id: 1, role: 1, from_date: 1, to_date: 1, ship: 1 } }
            ],
            as: "assignments"
          }
        },

        // Current assignment
        {
          $addFields: {
            currentAssignment: {
              $let: {
                vars: {
                  open: {
                    $filter: {
                      input: "$assignments",
                      as: "a",
                      cond: { $or: [ { $eq: ["$$a.to_date", null] }, { $not: ["$$a.to_date"] } ] }
                    }
                  }
                },
                in: {
                  $cond: [
                    { $gt: [ { $size: "$$open" }, 0 ] },
                    { $arrayElemAt: ["$$open", 0] },
                    { $arrayElemAt: ["$assignments", 0] }
                  ]
                }
              }
            }
          }
        },

        // Recent events
        {
          $lookup: {
            from: "events",
            let: { personId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $in: ["$$personId", { $ifNull: ["$participants", []] }] },
                      { $in: ["$$personId", { $ifNull: ["$crew", []] }] },
                      { $in: ["$$personId", { $ifNull: ["$personnel_ids", []] }] }
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

        // Normalize picUrl; final projection
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
        {
          $project: {
            _id: 1, name: 1, first: 1, middle: 1, surname: 1, rank: 1, division: 1,
            picUrl: 1, assignments: 1, currentAssignment: 1, recentEvents: 1
          }
        }
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
    const perPage = Math.max(1, Math.min(parseInt(u.searchParams.get("personnelPerPage") || "10", 10), 200));
    const page = Math.max(0, parseInt(u.searchParams.get("page") || "0", 10));
    const skip = page * perPage;

    const filter = {};
    if (name) {
      const re = new RegExp(escRe(name), "i");
      filter.$or = [{ surname: re }, { first: re }];
    }

    const total = await col.countDocuments(filter);

    const docs = await col.aggregate([
      { $match: filter },
      { $sort: { surname: 1, first: 1, middle: 1, _id: 1 } },
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
      { $project: { _id: 1, name: 1, first: 1, middle: 1, surname: 1, rank: 1, division: 1, picUrl: 1 } }
    ]).toArray();

    const personnel = docs.map(d => ({ ...d, _id: String(d._id) }));
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({
      personnel,
      page,
      entries_per_page: perPage,
      total_results: total
    }));
    // ---------- END LIST BRANCH ----------
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: e.message || "Internal error", debug: "personnel detail/list pipeline" }));
  }
};
