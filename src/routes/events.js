// api/starfleet/events.js
const { getDb } = require("../db");
const { ObjectId } = require("bson");

// --- helpers ---
function isHex24(s) {
  return typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s);
}
function toObjectId(v) {
  if (!v) return v;
  if (isHex24(v)) return new ObjectId(v);
  return v; // allow legacy string ids if present
}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
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

// --- main handler ---
module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();

  // Preflight
  if (method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const db = await getDb();
  const col = db.collection("events");

  try {
    switch (method) {
      // ---------------------- GET ----------------------
      case "GET": {
        const u = new URL(req.url, "http://local");
        const id = u.searchParams.get("id");

        // sort: match old behavior parseInt(sort) || 1
        const sortRaw = parseInt(u.searchParams.get("sort") || "1", 10);
        const eventSort = { date: Number.isFinite(sortRaw) ? sortRaw : 1 };

        // legacy params
        let officer_id = u.searchParams.get("officer_id");
        let starship_id = u.searchParams.get("starship_id");
        const subject_id = u.searchParams.get("subject_id");

        // convenience: if subject_id is present and neither explicit is set,
        // treat it like officer_id (matches how the officer page called this)
        if (subject_id && !officer_id && !starship_id) {
          officer_id = subject_id;
        }

        // category semantics from legacy:
        //  - "Assign-Pro-De" => OR Assignment/Promotion/Demotion
        //  - "Chronology"    => type exists
        //  - else            => type equals the category
        const category = (u.searchParams.get("category") || "").trim();

        if (!id) {
          // -------- list mode --------
          let idQuery = {};
          let idType = {};

          if (officer_id) {
            idQuery = { officerId: toObjectId(officer_id) };
          } else {
            // starship path by default (and exclude officerId docs, as in legacy)
            idQuery = {
              $and: [
                { starshipId: toObjectId(starship_id) },
                { officerId: { $exists: false } },
              ],
            };
          }

          if (category === "Assign-Pro-De") {
            idType = { $or: [{ type: "Assignment" }, { type: "Promotion" }, { type: "Demotion" }] };
            // If starship_id is present, legacy overrides idQuery to a simple ship match
            if (starship_id) {
              idQuery = { starshipId: toObjectId(starship_id) };
            }
          } else if (category === "Chronology") {
            idType = { type: { $exists: true } };
          } else if (category) {
            idType = { type: category };
          }

          const matchQuery = { $and: [idQuery, idType] };

          let pipeline;

          if (starship_id && !officer_id) {
            // --- STARSHIP VIEW (gather officer info) ---
            pipeline = [
              { $match: matchQuery },
              {
                $lookup: {
                  from: "officers",
                  let: { id: "$officerId" },
                  pipeline: [
                    { $match: { $expr: { $eq: ["$_id", "$$id"] } } },
                    { $project: { _id: 0, surname: 1, first: 1, middle: 1 } },
                  ],
                  as: "info",
                },
              },
              { $sort: eventSort },
              {
                $replaceRoot: {
                  newRoot: { $mergeObjects: [{ $arrayElemAt: ["$info", 0] }, "$$ROOT"] },
                },
              },
              { $project: { info: 0, __v: 0, starshipId: 0 } },
              {
                $lookup: {
                  from: "photos",
                  let: { id: "$officerId" },
                  pipeline: [
                    { $match: { $and: [{ $expr: { $eq: ["$owner", "$$id"] } }, { primary: true }] } },
                    { $project: { _id: 0, url: 1 } },
                  ],
                  as: "officerPics",
                },
              },
              { $addFields: { officerPicUrl: "$officerPics.url" } },
              { $project: { officerPics: 0 } },
            ];
          } else {
            // --- OFFICER VIEW (gather starship info) ---
            pipeline = [
              { $match: matchQuery },
              {
                $lookup: {
                  from: "starships",
                  let: { id: "$starshipId" },
                  pipeline: [
                    { $match: { $expr: { $eq: ["$_id", "$$id"] } } },
                    { $project: { _id: 0, name: 1, registry: 1, class: 1, ship_id: 1 } },
                  ],
                  as: "info",
                },
              },
              { $sort: eventSort },
              {
                $replaceRoot: {
                  newRoot: { $mergeObjects: [{ $arrayElemAt: ["$info", 0] }, "$$ROOT"] },
                },
              },
              { $project: { info: 0, __v: 0, officerId: 0 } },
              {
                $lookup: {
                  from: "photos",
                  let: { id: "$starshipId" },
                  pipeline: [
                    { $match: { $and: [{ $expr: { $eq: ["$owner", "$$id"] } }, { primary: true }] } },
                    { $project: { _id: 0, url: 1 } },
                  ],
                  as: "starshipPics",
                },
              },
              { $addFields: { starshipPicUrl: "$starshipPics.url" } },
              { $project: { starshipPics: 0 } },
            ];
          }

          const responseData = await col.aggregate(pipeline).toArray();

          // stringify IDs/dates to match legacy output
          for (const event of responseData) {
            if (event._id) event._id = String(event._id);
            if (event.date) event.date = toIsoOrNull(event.date);
            if (event.endDate) event.endDate = toIsoOrNull(event.endDate);
            if (event.starshipId) event.starshipId = String(event.starshipId);
            if (event.ship_id) event.ship_id = String(event.ship_id);
            if (event.officerId) event.officerId = String(event.officerId);
          }

          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify(responseData));
        }

        // -------- single doc by id --------
        const doc = await col.findOne({ _id: toObjectId(id) });
        if (!doc) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Not found" }));
        }

        const responseData = { ...doc };
        responseData._id = String(responseData._id);
        if (responseData.officerId) responseData.officerId = String(responseData.officerId);
        if (responseData.starshipId) responseData.starshipId = String(responseData.starshipId);
        if (responseData.ship_id) responseData.ship_id = String(responseData.ship_id);
        if (responseData.date) responseData.date = toIsoOrNull(responseData.date);
        if (responseData.endDate) responseData.endDate = toIsoOrNull(responseData.endDate);
        delete responseData["__v"];

        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify(responseData));
      }

      // ---------------------- POST ----------------------
      case "POST": {
        const body = await readJsonBody(req);

        const eventInfo = { ...body };
        if (eventInfo.starshipId) eventInfo.starshipId = toObjectId(eventInfo.starshipId);
        if (eventInfo.officerId) eventInfo.officerId = toObjectId(eventInfo.officerId);
        if (eventInfo.date) eventInfo.date = new Date(eventInfo.date);
        if (eventInfo.endDate) eventInfo.endDate = new Date(eventInfo.endDate);

        try {
          await col.insertOne(eventInfo);
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Record Inserted Successfully" }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: `Record Insert Failed ${err.message}` }));
        }
      }

      // ---------------------- DELETE ----------------------
      case "DELETE": {
        const u = new URL(req.url, "http://local");
        const id = u.searchParams.get("id");
        if (!id || !isHex24(id)) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Valid id is required" }));
        }
        try {
          await col.deleteOne({ _id: new ObjectId(id) });
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Event Record Successfully Deleted" }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: `Deletion of Record Failed ${err.message}` }));
        }
      }

      // ---------------------- PUT ----------------------
      case "PUT": {
        const body = await readJsonBody(req);
        const updatedInfo = { ...body };
        const eventId = updatedInfo._id;

        if (!eventId || !isHex24(eventId)) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Valid _id is required" }));
        }

        if (updatedInfo.date) updatedInfo.date = new Date(updatedInfo.date);
        if (updatedInfo.endDate) updatedInfo.endDate = new Date(updatedInfo.endDate);
        if (updatedInfo.starshipId) updatedInfo.starshipId = toObjectId(updatedInfo.starshipId);
        if (updatedInfo.officerId) updatedInfo.officerId = toObjectId(updatedInfo.officerId);
        delete updatedInfo["_id"];

        try {
          await col.updateOne({ _id: new ObjectId(eventId) }, { $set: updatedInfo });
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Record Updated Successfully" }));
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
