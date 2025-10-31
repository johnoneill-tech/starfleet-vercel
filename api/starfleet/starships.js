// api/starfleet/starships.js
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
    const col = db.collection("starships");
    const u = new URL(req.url || req.originalUrl || "/", "http://local");
    const id = u.searchParams.get("id");

    // ---------- DETAIL (matches Realm) ----------
    if (id) {
      if (!isHex24(id)) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Invalid id" }));
      }

      const pipeline = [
        { $match: { _id: new ObjectId(id) } },

        // primary ship photo
        {
          $lookup: {
            from: "photos",
            let: { id: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$owner", "$$id"] } }, { primary: true }] } },
              { $project: { _id: 0, url: 1 } },
            ],
            as: "shipPics",
          },
        },
        { $addFields: { picUrl: "$shipPics.url" } },
        { $project: { shipPics: 0 } },

        // personnelCount from Assignment events
        {
          $lookup: {
            from: "events",
            let: { id: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$starshipId", "$$id"] } }, { type: "Assignment" }] } },
              { $group: { _id: "$officerId" } },
              { $count: "personnelNum" },
            ],
            as: "personnelAssignments",
          },
        },
        { $addFields: { personnelCount: "$personnelAssignments.personnelNum" } },
        { $project: { personnelAssignments: 0 } },

        // missionCount from Mission events (without officerId)
        {
          $lookup: {
            from: "events",
            let: { id: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$starshipId", "$$id"] } }, { type: "Mission" }, { officerId: { $exists: false } }] } },
              { $count: "missonNum" },
            ],
            as: "missions",
          },
        },
        { $addFields: { missionCount: "$missions.missonNum" } },
        { $project: { missions: 0 } },
      ];

      let doc = await col.aggregate(pipeline).next();
      if (!doc) { res.statusCode = 404; res.setHeader("content-type","application/json; charset=utf-8"); return res.end(JSON.stringify({ message: "Not Found" })); }

      doc._id = String(doc._id);
      ["launch_date","commission_date","decommission_date","destruction_date"].forEach(k => { if (doc[k]) doc[k] = new Date(doc[k]).toISOString(); });
      if (doc.personnelCount) doc.personnelCount = doc.personnelCount.toString();
      if (doc.missionCount) doc.missionCount = doc.missionCount.toString();
      if (doc.ship_id) doc.ship_id = String(doc.ship_id);

      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify(doc));
    }

    // ---------- LIST (matches Realm) ----------
    let starshipsPerPage = parseInt(u.searchParams.get("starshipsPerPage") || "12", 10);
    const page = parseInt(u.searchParams.get("page") || "0", 10);
    const name = (u.searchParams.get("name") || "").trim();           // prefix
    const klass = (u.searchParams.get("class") || "").trim();         // All | Unknown | exact
    const timeframe = (u.searchParams.get("timeframe") || "").trim(); // 22nd/23rd/24th/32nd

    // name prefix
    let nameQuery = {};
    if (name) nameQuery = { name: { $regex: "^" + escRe(name) + ".*", $options: "i" } };

    // class filter
    let classQuery = {};
    if (klass && klass !== "All") {
      if (klass === "Unknown") {
        classQuery = {
          $or: [
            { class: { $exists: false } },
            { class: null },
            { class: "" }
          ]
        };
      } else {
        classQuery = { class: { $regex: "^" + escRe(klass) + "$", $options: "i" } };
      }
    }

    // timeframe -> ship_id ranges (your Realm ranges)
    let startTimeFrame = 0, endTimeFrame = 999999;
    if (timeframe === "22nd") { startTimeFrame = 0; endTimeFrame = 400; }
    if (timeframe === "23rd") { startTimeFrame = 400; endTimeFrame = 2500; }
    if (timeframe === "24th") { startTimeFrame = 2500; endTimeFrame = 110000; }
    if (timeframe === "32nd") { startTimeFrame = 110000; endTimeFrame = 999999; }
    const timeQuery = { $and: [{ ship_id: { $gte: startTimeFrame } }, { ship_id: { $lt: endTimeFrame } }] };

    const query = { $and: [nameQuery, classQuery, timeQuery] };

    const pipeline = [
      { $match: query },

      // primary ship photo
      {
        $lookup: {
          from: "photos",
          let: { id: "$_id" },
          pipeline: [
            { $match: { $and: [{ $expr: { $eq: ["$owner", "$$id"] } }, { primary: true }] } },
            { $project: { _id: 0, title: 0, description: 0, owner: 0, url: 1 } },
          ],
          as: "shipPics",
        },
      },
      { $addFields: { picUrl: "$shipPics.url" } },
      { $project: { shipPics: 0 } },

      // personnelCount
      {
        $lookup: {
          from: "events",
          let: { id: "$_id" },
          pipeline: [
            { $match: { $and: [{ $expr: { $eq: ["$starshipId", "$$id"] } }, { type: "Assignment" }] } },
            { $group: { _id: "$officerId" } },
            { $count: "personnelNum" },
          ],
          as: "personnelAssignments",
        },
      },
      { $addFields: { personnelCount: "$personnelAssignments.personnelNum" } },
      { $project: { personnelAssignments: 0 } },

      // missionCount
      {
        $lookup: {
          from: "events",
          let: { id: "$_id" },
          pipeline: [
            { $match: { $and: [{ $expr: { $eq: ["$starshipId", "$$id"] } }, { type: "Mission" }, { officerId: { $exists: false } }] } },
            { $count: "missonNum" },
          ],
          as: "missions",
        },
      },
      { $addFields: { missionCount: "$missions.missonNum" } },
      { $project: { missions: 0 } },

      { $sort: { ship_id: 1 } },
      { $skip: page * starshipsPerPage },
      { $limit: starshipsPerPage },
    ];

    const list = await col.aggregate(pipeline).toArray();
    list.forEach(s => {
      s._id = String(s._id);
      if (s.ship_id != null) s.ship_id = String(s.ship_id);
      ["launch_date","commission_date","decommission_date","destruction_date"].forEach(k => { if (s[k]) s[k] = new Date(s[k]).toISOString(); });
    });

    const total = await col.countDocuments(query);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({
      starships: list,
      page: String(page),
      entries_per_page: String(starshipsPerPage),
      total_results: String(total),
      search_queries: query,
    }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ message: e.message || "Internal error" }));
  }
};
