// src/routes/starships.js
// Search + detail (with picUrl[]), CRUD, and detail-level counts for UI buttons.

const { getDb } = require("../db");
const { ObjectId } = require("bson");

// -------- helpers ----------
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

// timeframe → numeric ship_id range (inclusive lower, exclusive upper)
function timeframeToRange(tf) {
  const t = String(tf || "All").trim().toLowerCase();
  if (t === "22nd") return { start: 0, end: 400 };
  if (t === "23rd") return { start: 400, end: 2500 };
  if (t === "24th") return { start: 2500, end: 110000 };
  if (t === "32nd") return { start: 110000, end: Number.POSITIVE_INFINITY };
  return { start: 0, end: Number.POSITIVE_INFINITY }; // All/unknown
}

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  const db = await getDb();
  const ships = db.collection("starships");

  try {
    // =================== GET ===================
    if (method === "GET") {
      const u = new URL(req.url, "http://local");
      const id = u.searchParams.get("id");

      // ------- LIST -------
      if (!id) {
        // inputs (normalize safely)
        const perPage = Math.max(1, Number(u.searchParams.get("starshipsPerPage") || 12));
        const page = Math.max(0, Number(u.searchParams.get("page") || 0));
        const name = (u.searchParams.get("name") || "").trim();
        const classRaw = (u.searchParams.get("class") || "All").trim();
        const timeframeRaw = (u.searchParams.get("timeframe") || "All").trim();
        const afterShipIdRaw = u.searchParams.get("after_ship_id");
        const afterShipId = afterShipIdRaw != null && afterShipIdRaw !== "" ? Number(afterShipIdRaw) : null;

        // base filters
        const ands = [];

        // name filter
        if (name) {
          ands.push({ name: { $regex: "^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ".*", $options: "i" } });
        }

        // class filter
        const classKey = classRaw.toLowerCase();
        if (classKey === "all" || classRaw === "") {
          // any or missing class
          ands.push({ $or: [{ class: { $exists: true } }, { class: { $exists: false } }] });
        } else if (classKey === "unknown") {
          ands.push({ class: { $exists: false } });
        } else {
          ands.push({ class: { $eq: classRaw } });
        }

        // timeframe → range
        const { start, end } = timeframeToRange(timeframeRaw);
        if (!(start === 0 && end === Number.POSITIVE_INFINITY)) {
          ands.push({ ship_id: { $gte: start, $lt: end } });
        }

        // ensure deterministic sort field exists & numeric
        ands.push({ ship_id: { $type: "number" } });

        // cursor (if provided) takes precedence over skip/page
        if (afterShipId != null && !Number.isNaN(afterShipId)) {
          ands.push({ ship_id: { $gt: afterShipId } });
        }

        const match = ands.length ? { $and: ands } : {};

        // If using page/skip, short-circuit when we are past total to avoid 500s
        const total = await ships.countDocuments(match);
        if ((afterShipId == null) && (page * perPage >= total)) {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({
            starships: [],
            page: String(page),
            entries_per_page: String(perPage),
            total_results: String(total),
            next_cursor: null
          }));
        }

        const pipeline = [
          { $match: match },
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
          { $sort: { ship_id: 1 } },
          ...(afterShipId == null ? [{ $skip: page * perPage }] : []),
          { $limit: perPage },
        ];

        let list = await ships.aggregate(pipeline, { allowDiskUse: true }).toArray();

        // Legacy conversions for transport
        for (const s of list) {
          if (s._id) s._id = String(s._id);
          if (s.ship_id != null) s.ship_id = String(s.ship_id);
        }

        // next_cursor for cursor clients (null if no more)
        const next_cursor = list.length ? { ship_id: list[list.length - 1].ship_id } : null;

        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({
          starships: list,
          page: String(page),
          entries_per_page: String(perPage),
          total_results: String(total),
          next_cursor
        }));
      }

      // ------- DETAIL (with counts) -------
      const pipeline = [
        { $match: { _id: toObjectId(id) } },

        // pictures (primary first)
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

        // personnelCount (Assignments/Promotion/Demotion with officerId)
        {
          $lookup: {
            from: "events",
            let: { sid: "$_id" },
            pipeline: [
              {
                $match: {
                  $and: [
                    { $expr: { $eq: ["$starshipId", "$$sid"] } },
                    { $or: [{ type: "Assignment" }, { type: "Promotion" }, { type: "Demotion" }] },
                    { officerId: { $exists: true } },
                    { position: { $ne: "Retired" } },
                  ],
                },
              },
              { $group: { _id: "$officerId" } },
              { $count: "count" },
            ],
            as: "personnelAgg",
          },
        },
        { $addFields: { personnelCount: { $ifNull: [{ $arrayElemAt: ["$personnelAgg.count", 0] }, 0] } } },
        { $project: { personnelAgg: 0 } },

        // missionCount
        {
          $lookup: {
            from: "events",
            let: { sid: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$starshipId", "$$sid"] } }, { type: "Mission" }] } },
              { $count: "count" },
            ],
            as: "missionAgg",
          },
        },
        { $addFields: { missionCount: { $ifNull: [{ $arrayElemAt: ["$missionAgg.count", 0] }, 0] } } },
        { $project: { missionAgg: 0 } },

        // maintenanceCount
        {
          $lookup: {
            from: "events",
            let: { sid: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$starshipId", "$$sid"] } }, { type: "Maintenance" }] } },
              { $count: "count" },
            ],
            as: "maintAgg",
          },
        },
        { $addFields: { maintenanceCount: { $ifNull: [{ $arrayElemAt: ["$maintAgg.count", 0] }, 0] } } },
        { $project: { maintAgg: 0 } },

        // firstContactCount
        {
          $lookup: {
            from: "events",
            let: { sid: "$_id" },
            pipeline: [
              { $match: { $and: [{ $expr: { $eq: ["$starshipId", "$$sid"] } }, { type: "First Contact" }] } },
              { $count: "count" },
            ],
            as: "fcAgg",
          },
        },
        { $addFields: { firstContactCount: { $ifNull: [{ $arrayElemAt: ["$fcAgg.count", 0] }, 0] } } },
        { $project: { fcAgg: 0 } },
      ];

      const doc = await ships.aggregate(pipeline, { allowDiskUse: true }).next();
      if (!doc) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Not found" }));
      }

      // legacy conversions
      doc._id = String(doc._id);
      if (doc.ship_id) doc.ship_id = String(doc.ship_id);
      for (const k of ["commission_date", "decommission_date", "launch_date", "destruction_date"]) {
        if (doc[k]) doc[k] = toIsoOrNull(doc[k]);
      }

      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify(doc));
    }

    // =================== POST ===================
    if (method === "POST") {
      const body = await readJsonBody(req);
      const doc = { ...body };

      if (doc.ship_id !== undefined && doc.ship_id !== null && doc.ship_id !== "") {
        doc.ship_id = parseInt(doc.ship_id, 10);
      }

      for (const k of ["commission_date", "decommission_date", "launch_date", "destruction_date"]) {
        if (doc[k]) doc[k] = new Date(doc[k]);
      }
      for (const k of ["crew_complement", "length", "width", "height"]) {
        if (doc[k] != null && doc[k] !== "") doc[k] = Number(doc[k]);
      }

      try {
        await ships.insertOne(doc);
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
      const starshipId = body._id;
      if (!starshipId || !isHex24(String(starshipId))) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Valid _id is required" }));
      }

      const updated = { ...body };
      delete updated._id;

      if (updated.ship_id !== undefined && updated.ship_id !== null && updated.ship_id !== "") {
        updated.ship_id = parseInt(updated.ship_id, 10);
      }

      for (const k of ["commission_date", "decommission_date", "launch_date", "destruction_date"]) {
        if (updated[k]) updated[k] = new Date(updated[k]);
      }
      for (const k of ["crew_complement", "length", "width", "height"]) {
        if (updated[k] != null && updated[k] !== "") updated[k] = Number(updated[k]);
      }

      try {
        await ships.updateOne({ _id: new ObjectId(starshipId) }, { $set: updated });
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
        await ships.deleteOne({ _id: new ObjectId(id) });
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Starship Record Successfully Deleted" }));
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
