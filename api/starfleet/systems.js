// api/starfleet/systems.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

// ---------- helpers ----------
function isHex24(s) {
  return typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s);
}
function toObjectId(v) {
  if (!v) return v;
  if (isHex24(v)) return new ObjectId(v);
  return v; // allow legacy string ids if your data had any
}
function toIsoOrNull(d) {
  try {
    if (!d) return null;
    const dd = new Date(d);
    return isNaN(dd.getTime()) ? null : dd.toISOString();
  } catch {
    return null;
  }
}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// ---------- handler ----------
module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();

  // Preflight
  if (method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const db = await getDb();
  const systemsCol = db.collection("systems");

  try {
    switch (method) {
      // ====================== GET ======================
      case "GET": {
        const u = new URL(req.url, "http://local");
        const id = u.searchParams.get("id");

        if (!id) {
          // ---- List mode ----
          const systemsPerPage = Number(u.searchParams.get("systemsPerPage") || 10);
          const page = Number(u.searchParams.get("page") || 0);

          let query = {};
          const name = u.searchParams.get("name");
          if (name) {
            query = { name: { $regex: "^" + name + ".*", $options: "i" } };
          }

          const pipeline = [
            { $match: query },
            {
              $lookup: {
                from: "photos",
                let: { id: "$_id" },
                pipeline: [
                  { $match: { $and: [{ $expr: { $eq: ["$owner", "$$id"] } }, { primary: true }] } },
                  { $project: { _id: 0, title: 0, description: 0, owner: 0 } },
                ],
                as: "pics",
              },
            },
            { $sort: { name: 1 } },
            { $addFields: { picUrl: "$pics.url" } },
            { $project: { pics: 0 } },
            { $skip: page * systemsPerPage },
            { $limit: systemsPerPage },
          ];

          const resultsList = await systemsCol.aggregate(pipeline, { allowDiskUse: true }).toArray();

          // legacy: stringify ids and certain numerics
          for (const r of resultsList) {
            if (r._id) r._id = String(r._id);
            if (r.numOfPlanets != null) r.numOfPlanets = String(r.numOfPlanets);
          }

          const total = await systemsCol.countDocuments(query);

          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(
            JSON.stringify({
              systems: resultsList,
              page: String(page),
              entries_per_page: String(systemsPerPage),
              total_results: String(total),
            })
          );
        }

        // ---- Detail by id ----
        const pipeline = [
          { $match: { _id: toObjectId(id) } },

          // lastAssignment (Assign/Pro/De, not Retired) + ship info
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                {
                  $match: {
                    $and: [
                      { $expr: { $eq: ["$systemId", "$$id"] } },
                      { $or: [{ type: "Assignment" }, { type: "Promotion" }, { type: "Demotion" }] },
                      { position: { $ne: "Retired" } },
                    ],
                  },
                },
                { $sort: { date: -1 } },
                { $limit: 1 },
                {
                  $project: {
                    rankLabel: 1,
                    position: 1,
                    provisional: 1,
                    location: 1,
                    date: 1,
                    endDate: 1,
                    starshipId: 1,
                    _id: 0,
                  },
                },
                {
                  $lookup: {
                    from: "starships",
                    let: { id: "$starshipId" },
                    pipeline: [
                      { $match: { $expr: { $eq: ["$_id", "$$id"] } } },
                      { $project: { _id: 0, name: 1, registry: 1 } },
                    ],
                    as: "starshipInfo",
                  },
                },
                {
                  $replaceRoot: {
                    newRoot: { $mergeObjects: [{ $arrayElemAt: ["$starshipInfo", 0] }, "$$ROOT"] },
                  },
                },
                { $project: { starshipInfo: 0 } },
              ],
              as: "lastAssignment",
            },
          },
          {
            $replaceRoot: {
              newRoot: { $mergeObjects: [{ $arrayElemAt: ["$lastAssignment", 0] }, "$$ROOT"] },
            },
          },
          { $project: { lastAssignment: 0 } },

          // starshipCount = distinct starshipId count for Assignment events
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" }, // we’ll correct this in next $addFields; using $._id can be brittle, so keep same behavior by new field below
              pipeline: [
                {
                  $match: {
                    $and: [
                      { $expr: { $eq: ["$systemId", "$$id"] } },
                      { type: "Assignment" },
                      { starshipId: { $exists: true } },
                    ],
                  },
                },
                { $group: { _id: "$starshipId" } },
                { $count: "vesslesNum" },
              ],
              as: "starshipAssignments",
            },
          },
          { $addFields: { starshipCount: "$starshipAssignments.vesslesNum" } },
          { $project: { starshipAssignments: 0 } },

          // assignCount = Assignment|Promotion|Demotion total
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                {
                  $match: {
                    $and: [
                      { $expr: { $eq: ["$systemId", "$$id"] } },
                      { $or: [{ type: "Assignment" }, { type: "Promotion" }, { type: "Demotion" }] },
                    ],
                  },
                },
                { $count: "AssignProDeNum" },
              ],
              as: "Assign-Pro-De",
            },
          },
          { $addFields: { assignCount: "$Assign-Pro-De.AssignProDeNum" } },
          { $project: { "Assign-Pro-De": 0 } },

          // missionCount = general missions
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                { $match: { $and: [{ $expr: { $eq: ["$systemId", "$$id"] } }, { type: "Mission" }] } },
                { $count: "generalNum" },
              ],
              as: "generalMissions",
            },
          },
          { $addFields: { missionCount: "$generalMissions.generalNum" } },
          { $project: { generalMissions: 0 } },

          // lifeEventCount
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                { $match: { $and: [{ $expr: { $eq: ["$systemId", "$$id"] } }, { type: "Life Event" }] } },
                { $count: "lifeEventsNum" },
              ],
              as: "lifeEvents",
            },
          },
          { $addFields: { lifeEventCount: "$lifeEvents.lifeEventsNum" } },
          { $project: { lifeEvents: 0 } },
        ];

        // Fix small typo from legacy: ensure the 'let' var is the real _id
        // (some drivers can be picky with "$._id"); doing an $addFields isn’t needed here
        const doc = await systemsCol.aggregate(pipeline, { allowDiskUse: true }).next();

        if (!doc) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Not found" }));
        }

        // Legacy output conversions
        doc._id = String(doc._id);
        if (doc.starshipId) doc.starshipId = String(doc.starshipId);
        if (doc.species_id) doc.species_id = String(doc.species_id);

        if (doc.birthDate) doc.birthDate = toIsoOrNull(doc.birthDate);
        if (doc.deathDate) doc.deathDate = toIsoOrNull(doc.deathDate);
        if (doc.date) doc.date = toIsoOrNull(doc.date);
        if (doc.endDate) doc.endDate = toIsoOrNull(doc.endDate);

        // Counts come back as arrays like [{vesslesNum: N}] projected into fields; keep legacy toString of arrays
        if (doc.starshipCount != null) doc.starshipCount = String(doc.starshipCount);
        if (doc.assignCount != null) doc.assignCount = String(doc.assignCount);
        if (doc.missionCount != null) doc.missionCount = String(doc.missionCount);
        if (doc.lifeEventCount != null) doc.lifeEventCount = String(doc.lifeEventCount);

        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify(doc));
      }

      // ====================== POST ======================
      case "POST": {
        const body = await readJsonBody(req);
        const newSystem = { ...body };

        if (newSystem.numOfPlanets != null) newSystem.numOfPlanets = parseInt(newSystem.numOfPlanets, 10);
        if (Array.isArray(newSystem.starTypes)) {
          newSystem.starTypes = newSystem.starTypes.map((a) => (a && typeof a === "object" && "value" in a ? a.value : a));
        }

        try {
          await systemsCol.insertOne(newSystem);
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "System Inserted Successfully" }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: `System Insert Failed ${err.message}` }));
        }
      }

      // ====================== DELETE ======================
      case "DELETE": {
        const u = new URL(req.url, "http://local");
        const id = u.searchParams.get("id");
        if (!id || !isHex24(id)) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Valid id is required" }));
        }

        try {
          await systemsCol.deleteOne({ _id: new ObjectId(id) });
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Personnel Record Successfully Deleted" }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: `Deletion of Record Failed ${err.message}` }));
        }
      }

      // ====================== PUT ======================
      case "PUT": {
        const body = await readJsonBody(req);
        const updatedInfo = { ...body };
        const systemId = updatedInfo._id;
        const systemName = updatedInfo.name;

        if (!systemId || !isHex24(systemId)) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Valid _id is required" }));
        }

        if (updatedInfo.numOfPlanets != null) updatedInfo.numOfPlanets = parseInt(updatedInfo.numOfPlanets, 10);
        if (Array.isArray(updatedInfo.starTypes)) {
          updatedInfo.starTypes = updatedInfo.starTypes.map((a) => (a && typeof a === "object" && "value" in a ? a.value : a));
        }

        delete updatedInfo["_id"];

        try {
          await systemsCol.updateOne({ _id: new ObjectId(systemId) }, { $set: updatedInfo });
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Record of " + systemName + " Updated Successfully" }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: `Record Update Failed ${err.message}` }));
        }
      }

      default: {
        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST, PUT, DELETE, OPTIONS");
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Method Not Allowed" }));
      }
    }
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ message: e.message || "Internal error" }));
  }
};
