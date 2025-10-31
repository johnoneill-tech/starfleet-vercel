// api/starfleet/photos.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

function isHex24(s) { return typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s); }
function oidOrString(v) { return isHex24(v) ? new ObjectId(v) : v; }
function asBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  if (typeof v === "number") return v !== 0;
  return false;
}

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  try {
    const db = await getDb();
    const col = db.collection("photos");

    // Parse URL & body safely
    const u = new URL(req.url || req.originalUrl || "/", "http://local");
    const id = u.searchParams.get("id");
    const subject_id = u.searchParams.get("subject_id") || u.searchParams.get("owner_id");
    const body = req.body || {};

    // ---------- GET ----------
    if (method === "GET") {
      // Single photo by id
      if (id) {
        if (!isHex24(id)) {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Invalid id" }));
        }
        const doc = await col.findOne(
          { _id: new ObjectId(id) },
          { projection: { url: 1, title: 1, description: 1, year: 1, primary: 1 } }
        );
        if (!doc) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return res.end(JSON.stringify({ message: "Not Found" }));
        }
        doc._id = String(doc._id);
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify(doc));
      }

      // All photos for a subject (subject_id or owner_id)
      if (!subject_id) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Missing subject_id" }));
      }

      // Match photos whose owner/subject_id equals the given subject (compare as strings)
      const pipeline = [
        {
          $match: {
            $expr: {
              $or: [
                { $eq: [ { $toString: "$owner" }, { $toString: subject_id } ] },
                { $eq: [ { $toString: "$subject_id" }, { $toString: subject_id } ] }
              ]
            }
          }
        },
        // Sort: primary first, then newest (created_at desc, _id desc)
        { $sort: { primary: -1, created_at: -1, _id: -1 } },
        { $project: { url: 1, title: 1, description: 1, year: 1, primary: 1 } }
      ];

      const items = await col.aggregate(pipeline).toArray();
      items.forEach(p => { if (p._id) p._id = String(p._id); });

      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify(items));
    }

    // ---------- POST ----------
    if (method === "POST") {
      // Expect: { subject_id/owner, url, title?, description?, year?, primary? }
      const ownerRaw = body.owner ?? body.subject_id;
      const url = body.url;
      if (!ownerRaw || !url) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "owner/subject_id and url are required" }));
      }

      const doc = {
        owner: oidOrString(ownerRaw),
        url: String(url),
        title: body.title ? String(body.title) : "",
        description: body.description ? String(body.description) : "",
        year: body.year ? String(body.year) : "",
        primary: asBool(body.primary),
        created_at: new Date()
      };

      // If setting primary, clear other primaries for this owner up front
      if (doc.primary === true) {
        await col.updateMany(
          {
            $expr: {
              $eq: [ { $toString: "$owner" }, { $toString: String(ownerRaw) } ]
            }
          },
          { $set: { primary: false } }
        );
      }

      const result = await col.insertOne(doc);
      res.statusCode = 201;
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok: true, _id: String(result.insertedId) }));
    }

    // ---------- PUT ----------
    if (method === "PUT") {
      // Accept either id in query or in body
      const pid = id || body.id || body._id;
      if (!pid || !isHex24(pid)) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Valid id is required" }));
      }

      const update = {};
      if (body.url != null) update.url = String(body.url);
      if (body.title != null) update.title = String(body.title);
      if (body.description != null) update.description = String(body.description);
      if (body.year != null) update.year = String(body.year);
      if (body.primary != null) update.primary = asBool(body.primary);
      if (body.owner != null || body.subject_id != null) {
        update.owner = oidOrString(body.owner ?? body.subject_id);
      }

      // If toggling primary true, unset others for that owner before setting
      if (update.primary === true) {
        // fetch existing to know owner
        const existing = await col.findOne({ _id: new ObjectId(pid) }, { projection: { owner: 1 } });
        const effOwner = update.owner ?? existing?.owner;
        if (effOwner) {
          await col.updateMany(
            {
              $and: [
                { _id: { $ne: new ObjectId(pid) } },
                {
                  $expr: {
                    $eq: [ { $toString: "$owner" }, { $toString: String(effOwner) } ]
                  }
                }
              ]
            },
            { $set: { primary: false } }
          );
        }
      }

      if (Object.keys(update).length === 0) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "No fields to update" }));
      }

      await col.updateOne({ _id: new ObjectId(pid) }, { $set: update });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok: true }));
    }

    // ---------- DELETE ----------
    if (method === "DELETE") {
      if (!id || !isHex24(id)) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ message: "Valid id is required" }));
      }
      await col.deleteOne({ _id: new ObjectId(id) });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok: true }));
    }

    // Fallback
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ message: "Method Not Allowed" }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ message: e.message || "Internal error" }));
  }
};
