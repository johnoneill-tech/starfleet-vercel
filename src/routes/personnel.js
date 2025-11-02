// src/routes/personnel.js
// Search + detail (with picUrl[]), lastAssignment merged into root, CRUD,
// and counts: assignCount, missionCount, lifeEventCount, starshipCount.

const { getDb } = require("../db");
const { ObjectId } = require("bson");

// ---------- helpers ----------
function isHex24(s) {
  return typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s);
}
function toObjectId(v) {
  if (!v) return v;
  return isHex24(v) ? new ObjectId(v) : v;
}
function toIsoOrNull(d) {
  try {
    if (!d) return null;
    const dd = new Date(d);
    return isNaN(dd.getTime()) ? null : dd.toISOString();
  } catch { return null; }
}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  const db = await getDb();
  const people = db.collection("officers");

  try {
    // =================== GET ===================
    if (method === "GET") {
      const u = new URL(req.url, "http://local");
      const id = u.searchParams.get("id");

      // ------- LIST -------
      if (!id) {
        const perPage = Number(u.searchParams.get("personnelPerPage") || 10);
        const page = Number(u.searchParams.get("page") || 0);
        const name = u.searchParams.get("name");

        let query = {};
        if (name) {
          query = {
            $or: [
              { surname: { $regex: "^" + name + ".*", $options: "i" } },
              { first:   { $regex: "^" + name + ".*", $options: "i" } },
              { middle:  { $regex: "^" + name + ".*", $options: "i" } },
              { alias:   { $regex: "^" + name + ".*", $options: "i" } },
              { name:    { $regex: "^" + name + ".*", $options: "i" } },
            ],
          };
        }

        const pipeline = [
          { $match: query },
          {
            $lookup: {
              from: "photos",
              let: { id: "$_id" },
              pipeline: [
                { $match: { $expr: { $eq: ["$owner", "$$id"] } } },
                { $sort: { primary: -1, _id: 1 } },
                { $project: { _id: 0, url: 1 } },
              ],
              as: "pics",
            },
          },
          { $addFields: { picUrl: "$pics.url" } },
          { $project: { pics: 0 } },
          { $sort: { surname: 1, first: 1, middle: 1 } },
          { $skip: page * perPage },
          { $limit: perPage },
        ];

        const list = await people.aggregate(pipeline, { allowDiskUse: true }).toArray();
        for (const p of list) {
          if (p._id) p._id = String(p._id);
          if (p.species_id) p.species_id = String(p.species_id);
          if (p.birthDate) p.birthDate = toIsoOrNull(p.birthDate);
          if (p.deathDate) p.deathDate = toIsoOrNull(p.deathDate);
        }

        const total = await people.countDocuments(query);

        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(
          JSON.stringify({
            personnel: list,
            page: String(page),
            entries_per_page: String(perPage),
            total_results: String(total),
          })
        );
      }

      // ------- DETAIL (pics + lastAssignment + counts incl. starshipCount) -------
      const pipeline = [
        { $match: { _id: toObjectId(id) } },

        // photos (primary first)
        {
          $lookup: {
            from: "photos",
            let: { id: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$owner", "$$id"] } } },
              { $sort: { primary: -1, _id: 1 } },
              { $project: { _id: 0, url: 1 } },
            ],
            as: "pics",
          },
        },
        { $addFields: { picUrl: "$pics.url" } },
        { $project: { pics: 0 } },

        // ---- LAST ASSIGNMENT (Assignment/Promotion/Demotion, not Retired) ----
        {
          $lookup: {
            from: "events",
            let: { oid: "$_id" },
            pipeline: [
              {
                $match: {
                  $and: [
                    { $expr: { $eq: ["$officerId", "$$oid"] } },
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
                  let: { sid: "$starshipId" },
                  pipeline: [
                    { $match: { $expr: { $eq: ["$_id", "$$sid"] } } },
                    { $project: { _id: 0, name: 1, registry: 1, class: 1 } },
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
        // merge lastAssignment[0] into the root so UI can read fields directly
        {
          $replaceRoot: {
            newRoot: { $mergeObjects: [{ $arrayElemAt: ["$lastAssignment", 0] }, "$$ROOT"] },
          },
        },
        { $project: { lastAssignment: 0 } },

        // ---- COUNTS from events for this officer ----

        // Assign/Pro/Dem total count (all events)
        {
          $lookup: {
            from: "events",
            let: { oid: "$_id" },
            pipeline: [
              {
                $match: {
                  $and: [
                    { $expr: { $eq: ["$officerId", "$$oid"] } },
                    { $or: [{ type: "Assignment" }, { type: "Promotion" }, { type: "Demotion" }] },
                  ],
                },
              },
              { $count: "count" },
            ],
            as: "apdAgg",
          },
        },
        { $addFields: { assignCount: { $ifNull: [{ $arrayElemAt: ["$apdAgg.count", 0] }, 0] } } },
        { $project: { apdAgg: 0 } },

        // Distinct starships served on (for "Starship Assignments" count)
        {
          $lookup: {
            from: "events",
            let: { oid: "$_id" },
            pipeline: [
              {
                $match: {
                  $and: [
                    { $expr: { $eq: ["$officerId", "$$oid"] } },
                    { $or: [{ type: "Assignment" }, { type: "Promotion" }, { type: "Demotion" }] },
                    { starshipId: { $exists: true } },
                  ],
                },
              },
              { $group: { _id: "$starshipId" } },
              { $count: "count" },
            ],
            as: "shipAgg",
          },
        },
        { $addFields: { starshipCount: { $ifNull: [{ $arrayElemAt: ["$shipAgg.count", 0] }, 0] } } },
        { $project: { shipAgg: 0 } },

        // Missions
        {
          $lookup: {
            from: "events",
            let: { oid: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$officerId", "$$oid"] } }, { type: "Mission" }] } },
              { $count: "count" },
            ],
            as: "missionAgg",
          },
        },
        { $addFields: { missionCount: { $ifNull: [{ $arrayElemAt: ["$missionAgg.count", 0] }, 0] } } },
        { $project: { missionAgg: 0 } },

        // Life Events
        {
          $lookup: {
            from: "events",
            let: { oid: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$officerId", "$$oid"] } }, { type: "Life Event" }] } },
              { $count: "count" },
            ],
            as: "lifeAgg",
          },
        },
        { $addFields: { lifeEventCount: { $ifNull: [{ $arrayElemAt: ["$lifeAgg.count", 0] }, 0] } } },
        { $project: { lifeAgg: 0 } },
      ];

      const doc = await people.aggregate(pipeline, { allowDiskUse: true }).next();
      if (!doc) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Not found" }));
      }

      // legacy conversions
      doc._id = String(doc._id);
      if (doc.species_id) doc.species_id = String(doc.species_id);
      if (doc.birthDate) doc.birthDate = toIsoOrNull(doc.birthDate);
      if (doc.deathDate) doc.deathDate = toIsoOrNull(doc.deathDate);
      if (doc.date) doc.date = toIsoOrNull(doc.date);
      if (doc.endDate) doc.endDate = toIsoOrNull(doc.endDate);
      if (doc.starshipId) doc.starshipId = String(doc.starshipId);

      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify(doc));
    }

    // =================== POST ===================
    if (method === "POST") {
      const body = await readJsonBody(req);
      const doc = { ...body };

      if (doc.species_id) doc.species_id = toObjectId(doc.species_id);
      if (doc.birthDate) doc.birthDate = new Date(doc.birthDate);
      if (doc.deathDate) doc.deathDate = new Date(doc.deathDate);

      try {
        await people.insertOne(doc);
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Record Inserted Successfully" }));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: `Record Insert Failed ${err.message}` }));
      }
    }

    // =================== PUT ===================
    if (method === "PUT") {
      const body = await readJsonBody(req);
      const personId = body._id;
      if (!personId || !isHex24(String(personId))) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Valid _id is required" }));
      }

      const updated = { ...body };
      delete updated._id;

      if (updated.species_id) updated.species_id = toObjectId(updated.species_id);
      if (updated.birthDate) updated.birthDate = new Date(updated.birthDate);
      if (updated.deathDate) updated.deathDate = new Date(updated.deathDate);

      try {
        await people.updateOne({ _id: new ObjectId(personId) }, { $set: updated });
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Record Updated Successfully" }));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: `Record Update Failed ${err.message}` }));
      }
    }

    // =================== DELETE ===================
    if (method === "DELETE") {
      const u = new URL(req.url, "http://local");
      const id = u.searchParams.get("id");
      if (!id || !isHex24(id)) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Valid id is required" }));
      }

      try {
        await people.deleteOne({ _id: new ObjectId(id) });
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Personnel Record Successfully Deleted" }));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: `Deletion of Record Failed ${err.message}` }));
      }
    }

    // Fallback
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST, PUT, DELETE");
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ message: "Method Not Allowed" }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ message: e.message || "Internal error" }));
  }
};
