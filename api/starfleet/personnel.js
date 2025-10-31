// api/starfleet/personnel.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function isHex24(s) { return typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s); }

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, OPTIONS");
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ message: "Method Not Allowed" }));
  }

  try {
    const db = await getDb();
    const col = db.collection("officers");

    const u = new URL(req.url || req.originalUrl || "/", "http://local");
    const id = u.searchParams.get("id");

    // ---------- DETAIL ----------
    if (id) {
      if (!isHex24(id)) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Invalid id" }));
      }

      const pipeline = [
        { $match: { _id: new ObjectId(id) } },

        // lastAssignment with ship
        {
          $lookup: {
            from: "events",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $and: [
                    { $expr: { $eq: ["$officerId", "$$id"] } },
                    { $or: [{ type: "Assignment" }, { type: "Promotion" }, { type: "Demotion" }] },
                    { position: { $ne: "Retired" } }
                  ]
                }
              },
              { $sort: { date: -1 } },
              { $limit: 1 },
              {
                $lookup: {
                  from: "starships",
                  let: { id: "$starshipId" },
                  pipeline: [
                    { $match: { $expr: { $eq: ["$_id", "$$id"] } } },
                    { $project: { _id: 0, name: 1, registry: 1 } }
                  ],
                  as: "starshipInfo"
                }
              },
              { $replaceRoot: { newRoot: { $mergeObjects: [{ $arrayElemAt: ["$starshipInfo", 0] }, "$$ROOT"] } } },
              { $project: { starshipInfo: 0 } }
            ],
            as: "lastAssignment"
          }
        },
        { $replaceRoot: { newRoot: { $mergeObjects: [{ $arrayElemAt: ["$lastAssignment", 0] }, "$$ROOT"] } } },
        { $project: { lastAssignment: 0 } },

        // counts
        {
          $lookup: {
            from: "events",
            let: { id: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$officerId", "$$id"] } }, { type: "Assignment" }, { starshipId: { $exists: true } }] } },
              { $group: { _id: "$starshipId" } },
              { $count: "vesslesNum" }
            ],
            as: "starshipAssignments"
          }
        },
        { $addFields: { starshipCount: "$starshipAssignments.vesslesNum" } },
        { $project: { starshipAssignments: 0 } },
        {
          $lookup: {
            from: "events",
            let: { id: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$officerId", "$$id"] } }, { $or: [{ type: "Assignment" }, { type: "Promotion" }, { type: "Demotion" }] }] } },
              { $count: "AssignProDeNum" }
            ],
            as: "Assign-Pro-De"
          }
        },
        { $addFields: { assignCount: "$Assign-Pro-De.AssignProDeNum" } },
        { $project: { "Assign-Pro-De": 0 } },
        {
          $lookup: {
            from: "events",
            let: { id: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$officerId", "$$id"] } }, { type: "Mission" }, { officerId: { $exists: false } }] } },
              { $count: "generalNum" }
            ],
            as: "generalMissions"
          }
        },
        { $addFields: { missionCount: "$generalMissions.generalNum" } },
        { $project: { generalMissions: 0 } },
        {
          $lookup: {
            from: "events",
            let: { id: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$officerId", "$$id"] } }, { type: "Life Event" }] } },
              { $count: "lifeEventsNum" }
            ],
            as: "lifeEvents"
          }
        },
        { $addFields: { lifeEventCount: "$lifeEvents.lifeEventsNum" } },
        { $project: { lifeEvents: 0 } },

        // photos: compare as strings (handles owner stored as ObjectId or string)
        {
          $lookup: {
            from: "photos",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $and: [
                    {
                      $expr: {
                        $eq: [
                          { $toString: "$owner" },
                          { $toString: "$$id" }
                        ]
                      }
                    },
                    { primary: true }
                  ]
                }
              },
              { $project: { _id: 0, url: 1 } }
            ],
            as: "primaryPics"
          }
        },
        {
          $lookup: {
            from: "photos",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      {
                        $eq: [
                          { $toString: "$owner" },
                          { $toString: "$$id" }
                        ]
                      },
                      {
                        $eq: [
                          { $toString: "$subject_id" },
                          { $toString: "$$id" }
                        ]
                      }
                    ]
                  }
                }
              },
              { $sort: { created_at: -1, _id: -1 } },
              { $limit: 1 },
              { $project: { _id: 0, url: 1 } }
            ],
            as: "fallbackPics"
          }
        },
        {
          $addFields: {
            picUrl: {
              $cond: [
                { $gt: [{ $size: "$primaryPics" }, 0] },
                "$primaryPics.url",
                {
                  $cond: [
                    { $gt: [{ $size: "$fallbackPics" }, 0] },
                    "$fallbackPics.url",
                    []
                  ]
                }
              ]
            }
          }
        },
        { $project: { primaryPics: 0, fallbackPics: 0 } }
      ];

      let doc = await col.aggregate(pipeline).next();
      if (!doc) { res.statusCode = 404; res.setHeader("content-type","application/json; charset=utf-8"); return res.end(JSON.stringify({ message: "Not Found" })); }

      ["birthDate","deathDate","date","endDate"].forEach(k => { if (doc[k]) doc[k] = new Date(doc[k]).toISOString(); });
      ["starshipCount","missionCount","assignCount","lifeEventCount"].forEach(k => { if (doc[k]) doc[k] = doc[k].toString(); });
      doc._id = String(doc._id);

      res.statusCode = 200;
      res.setHeader("content-type","application/json; charset=utf-8");
      return res.end(JSON.stringify(doc));
    }

    // ---------- LIST ----------
    const personnelPerPage = parseInt(u.searchParams.get("personnelPerPage") || "10", 10);
    const page = parseInt(u.searchParams.get("page") || "0", 10);
    const name = (u.searchParams.get("name") || "").trim();

    const query = name
      ? { $or: [{ surname: { $regex: escRe(name), $options: "i" } }, { first: { $regex: escRe(name), $options: "i" } }] }
      : { _id: { $exists: true } };

    const list = await col.aggregate([
      { $match: query },
      {
        $lookup: {
          from: "photos",
          let: { id: "$_id" },
          pipeline: [
            {
              $match: {
                $and: [
                  {
                    $expr: {
                      $eq: [
                        { $toString: "$owner" },
                        { $toString: "$$id" }
                      ]
                    }
                  },
                  { primary: true }
                ]
              }
            },
            { $project: { _id: 0, url: 1 } }
          ],
          as: "officerPics"
        }
      },
      { $sort: { surname: 1, first: 1, middle: 1 } },
      { $addFields: { picUrl: "$officerPics.url" } },
      { $project: { officerPics: 0 } },
      { $skip: page * personnelPerPage },
      { $limit: personnelPerPage }
    ]).toArray();

    list.forEach(o => {
      o._id = String(o._id);
      ["birthDate","deathDate"].forEach(k => { if (o[k]) o[k] = new Date(o[k]).toISOString(); });
    });

    const total = await col.countDocuments(query);
    res.statusCode = 200;
    res.setHeader("content-type","application/json; charset=utf-8");
    return res.end(JSON.stringify({
      personnel: list,
      page: String(page),
      entries_per_page: String(personnelPerPage),
      total_results: String(total)
    }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type","application/json; charset=utf-8");
    return res.end(JSON.stringify({ message: e.message || "Internal error" }));
  }
};
