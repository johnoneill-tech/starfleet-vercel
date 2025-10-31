// api/starfleet/starships.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

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
    const col = db.collection("starships");
    const u = new URL(req.url || req.originalUrl || "/", "http://local");
    const id = u.searchParams.get("id");

    // ---------- DETAIL ----------
    if (id) {
      if (!/^[0-9a-fA-F]{24}$/.test(id)) { res.statusCode = 400; res.setHeader("content-type","application/json; charset=utf-8"); return res.end(JSON.stringify({ message: "Invalid id" })); }

      const pipeline = [
        { $match: { _id: new ObjectId(id) } },

        // photos: compare as strings (owner/subject_id may be string or ObjectId)
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
        { $project: { primaryPics: 0, fallbackPics: 0 } },

        // counts (unchanged)
        {
          $lookup: {
            from: "events",
            let: { id: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$starshipId", "$$id"] } }, { type: "Assignment" }] } },
              { $group: { _id: "$officerId" } },
              { $count: "personnelNum" }
            ],
            as: "personnelAssignments"
          }
        },
        { $addFields: { personnelCount: "$personnelAssignments.personnelNum" } },
        { $project: { personnelAssignments: 0 } },
        {
          $lookup: {
            from: "events",
            let: { id: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$starshipId", "$$id"] } }, { type: "Mission" }, { officerId: { $exists: false } }] } },
              { $count: "missonNum" }
            ],
            as: "missions"
          }
        },
        { $addFields: { missionCount: "$missions.missonNum" } },
        { $project: { missions: 0 } }
      ];

      let doc = await col.aggregate(pipeline).next();
      if (!doc) { res.statusCode = 404; res.setHeader("content-type","application/json; charset=utf-8"); return res.end(JSON.stringify({ message: "Not Found" })); }

      doc._id = String(doc._id);
      ["launch_date","commission_date","decommission_date","destruction_date"].forEach(k => { if (doc[k]) doc[k] = new Date(doc[k]).toISOString(); });
      if (doc.personnelCount) doc.personnelCount = doc.personnelCount.toString();
      if (doc.missionCount) doc.missionCount = doc.missionCount.toString();
      if (doc.ship_id != null) doc.ship_id = String(doc.ship_id);

      res.statusCode = 200;
      res.setHeader("content-type","application/json; charset=utf-8");
      return res.end(JSON.stringify(doc));
    }

    // ---------- LIST ----------
    let starshipsPerPage = parseInt(u.searchParams.get("starshipsPerPage") || "12", 10);
    const page = parseInt(u.searchParams.get("page") || "0", 10);
    const name = (u.searchParams.get("name") || "").trim();
    const klass = (u.searchParams.get("class") || "").trim();
    const timeframe = (u.searchParams.get("timeframe") || "").trim();

    let nameQuery = {};
    if (name) nameQuery = { name: { $regex: "^" + escRe(name) + ".*", $options: "i" } };

    let classQuery = {};
    if (klass && klass !== "All") {
      if (klass === "Unknown") {
        classQuery = { $or: [{ class: { $exists: false } }, { class: null }, { class: "" }] };
      } else {
        classQuery = { class: { $regex: "^" + escRe(klass) + "$", $options: "i" } };
      }
    }

    let startTimeFrame = 0, endTimeFrame = 999999;
    if (timeframe === "22nd") { startTimeFrame = 0; endTimeFrame = 400; }
    if (timeframe === "23rd") { startTimeFrame = 400; endTimeFrame = 2500; }
    if (timeframe === "24th") { startTimeFrame = 2500; endTimeFrame = 110000; }
    if (timeframe === "32nd") { startTimeFrame = 110000; endTimeFrame = 999999; }
    const timeQuery = { $and: [{ ship_id: { $gte: startTimeFrame } }, { ship_id: { $lt: endTimeFrame } }] };

    const and = [];
    if (Object.keys(nameQuery).length) and.push(nameQuery);
    if (Object.keys(classQuery).length) and.push(classQuery);
    and.push(timeQuery);
    const query = and.length ? { $and: and } : { _id: { $exists: true } };

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
          as: "shipPics"
        }
      },
      { $addFields: { picUrl: "$shipPics.url" } },
      { $project: { shipPics: 0 } },
      {
        $lookup: {
          from: "events",
          let: { id: "$_id" },
          pipeline: [
            { $match: { $and: [{ $expr: { $eq: ["$starshipId", "$$id"] } }, { type: "Assignment" }] } },
            { $group: { _id: "$officerId" } },
            { $count: "personnelNum" }
          ],
          as: "personnelAssignments"
        }
      },
      { $addFields: { personnelCount: "$personnelAssignments.personnelNum" } },
      { $project: { personnelAssignments: 0 } },
      {
        $lookup: {
          from: "events",
          let: { id: "$_id" },
          pipeline: [
            { $match: { $and: [{ $expr: { $eq: ["$starshipId", "$$id"] } }, { type: "Mission" }, { officerId: { $exists: false } }] } },
            { $count: "missonNum" }
          ],
          as: "missions"
        }
      },
      { $addFields: { missionCount: "$missions.missonNum" } },
      { $project: { missions: 0 } },
      { $sort: { ship_id: 1 } },
      { $skip: page * starshipsPerPage },
      { $limit: starshipsPerPage }
    ]).toArray();

    list.forEach(s => {
      s._id = String(s._id);
      if (s.ship_id != null) s.ship_id = String(s.ship_id);
    });

    const total = await col.countDocuments(query);
    res.statusCode = 200;
    res.setHeader("content-type","application/json; charset=utf-8");
    return res.end(JSON.stringify({
      starships: list,
      page: String(page),
      entries_per_page: String(starshipsPerPage),
      total_results: String(total)
    }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type","application/json; charset=utf-8");
    return res.end(JSON.stringify({ message: e.message || "Internal error" }));
  }
};
