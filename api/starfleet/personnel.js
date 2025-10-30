// api/starfleet/personnel.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

/* utils */
function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
function parseUrl(req) {
  try { return new URL(req.url || req.originalUrl || "/", "http://local"); }
  catch { return new URL("/", "http://local"); }
}
async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {}; try { return JSON.parse(raw); } catch { return {}; }
}
function toObjectId(id, field = "id") {
  try { return new ObjectId(String(id)); }
  catch { throw new Error(`Invalid ${field}: must be a 24-hex ObjectId string`); }
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  try {
    const db = await getDb();
    const col = db.collection("officers");

    // inside api/starfleet/starships.js, replace ONLY the GET handler
    if (method === "GET") {
    const u = parseUrl(req);
    const id = u.searchParams.get("id");
    const name = (u.searchParams.get("name") || "").trim();
    const klass = (u.searchParams.get("class") || "").trim();
    const timeframe = (u.searchParams.get("timeframe") || "").trim();

    const perPage = Math.max(1, Math.min(parseInt(u.searchParams.get("starshipsPerPage") || "12", 10), 200));
    const cursor = (u.searchParams.get("cursor") || "").trim(); // NEW

    if (id) {
        const _id = toObjectId(id, "id");
        const doc = await col.aggregate([
        { $match: { _id } },
        { $lookup: {
            from: "photos",
            let: { ownerId: "$_id" },
            pipeline: [
                { $match: { $expr: { $eq: ["$owner", "$$ownerId"] } } },
                { $sort: { created_at: -1, _id: -1 } },
                { $limit: 1 },
                { $project: { _id: 0, url: 1 } }
            ],
            as: "primaryPhoto"
        }},
        { $addFields: { picUrl: { $ifNull: [ { $arrayElemAt: ["$primaryPhoto.url", 0] }, null ] } } },
        { $project: { _id: 1, name: 1, class: 1, registry: 1, ship_id: 1, picUrl: 1 } }
        ]).next();
        if (!doc) return json(res, 404, { ok: false, error: "Not Found" });
        return json(res, 200, { ok: true, id: String(doc._id), ...doc, _id: undefined });
    }

    // Build filters (same as before)
    const filter = {};
    if (name) filter.name = { $regex: "^" + escRe(name) + ".*", $options: "i" }; // prefix
    if (klass) {
        if (klass === "All") {
        // no-op
        } else if (klass === "Unknown") {
        filter.$or = [
            ...(filter.$or || []),
            { class: { $exists: false } },
            { class: null },
            { class: "" }
        ];
        } else {
        filter.class = { $regex: "^" + escRe(klass) + "$", $options: "i" }; // exact (ci)
        }
    }
    Object.assign(filter, timeframeMatch(timeframe)); // ship_id ranges

    // Cursor decoding: base64("ship_id:_idHex")
    let afterShipId = null, afterId = null;
    if (cursor) {
        try {
        const decoded = Buffer.from(cursor, "base64").toString("utf8"); // e.g. "2500:65f2...ab3"
        const [sid, hex] = decoded.split(":");
        afterShipId = Number(sid);
        afterId = toObjectId(hex, "cursor");
        if (!Number.isFinite(afterShipId)) throw new Error("bad ship_id");
        } catch {
        return json(res, 400, { ok: false, error: "Invalid cursor" });
        }
    }

    // Keyset (seek) condition: (ship_id > afterShipId) OR (ship_id == afterShipId AND _id > afterId)
    const seek = (afterShipId != null && afterId)
        ? { $or: [ { ship_id: { $gt: afterShipId } }, { ship_id: afterShipId, _id: { $gt: afterId } } ] }
        : {};

    const finalMatch = Object.keys(seek).length ? { $and: [filter, seek] } : filter;

    // Fetch perPage + 1 to detect next page
    const docs = await col.aggregate([
        { $match: finalMatch },
        { $sort: { ship_id: 1, _id: 1 } },
        { $limit: perPage + 1 },
        { $lookup: {
            from: "photos",
            let: { ownerId: "$_id" },
            pipeline: [
            { $match: { $expr: { $eq: ["$owner", "$$ownerId"] } } },
            { $sort: { created_at: -1, _id: -1 } },
            { $limit: 1 },
            { $project: { _id: 0, url: 1 } }
            ],
            as: "primaryPhoto"
        }},
        { $addFields: { picUrl: { $ifNull: [ { $arrayElemAt: ["$primaryPhoto.url", 0] }, null ] } } },
        { $project: { _id: 1, name: 1, class: 1, registry: 1, ship_id: 1, picUrl: 1 } }
    ]).toArray();

    let next_cursor = null;
    let slice = docs;
    if (docs.length > perPage) {
        const last = docs[perPage - 1];
        next_cursor = Buffer.from(`${last.ship_id}:${String(last._id)}`, "utf8").toString("base64");
        slice = docs.slice(0, perPage);
    }

    const items = slice.map(d => ({
        id: String(d._id),
        name: d.name,
        class: d.class,
        registry: d.registry,
        ship_id: d.ship_id,
        picUrl: d.picUrl
    }));

    return json(res, 200, { items, next_cursor });
    }


    if (method === "POST") {
      const body = await readJsonBody(req);
      const name = (body.name || "").trim();
      if (!name) return json(res, 400, { ok: false, error: "name is required" });

      const doc = { name, created_at: new Date(), updated_at: new Date() };
      if (typeof body.rank === "string") doc.rank = body.rank;
      if (typeof body.division === "string") doc.division = body.division;
      if (body.rank_id) doc.rank_id = toObjectId(body.rank_id, "rank_id");

      const r = await col.insertOne(doc);
      return json(res, 201, { ok: true, id: String(r.insertedId), name: doc.name });
    }

    if (method === "PUT" || method === "PATCH") {
      const body = await readJsonBody(req);
      if (!body.id) return json(res, 400, { ok: false, error: "id is required" });
      const _id = toObjectId(body.id, "id");

      const $set = { updated_at: new Date() };
      if (typeof body.name === "string") $set.name = body.name.trim();
      if (typeof body.rank === "string") $set.rank = body.rank;
      if (typeof body.division === "string") $set.division = body.division;
      if (body.rank_id !== undefined) $set.rank_id = body.rank_id ? toObjectId(body.rank_id, "rank_id") : undefined;

      Object.keys($set).forEach(k => $set[k] === undefined && delete $set[k]);
      if (Object.keys($set).length === 1) return json(res, 400, { ok: false, error: "No updatable fields provided" });

      const r = await col.updateOne({ _id }, { $set });
      if (r.matchedCount === 0) return json(res, 404, { ok: false, error: "Not Found" });

      const doc = await col.findOne({ _id }, { projection: { _id: 1, name: 1 } });
      return json(res, 200, { ok: true, id: String(_id), name: doc?.name || null });
    }

    if (method === "DELETE") {
      const u = parseUrl(req);
      const id = u.searchParams.get("id");
      if (!id) return json(res, 400, { ok: false, error: "id is required" });
      const _id = toObjectId(id, "id");

      const r = await col.deleteOne({ _id });
      if (r.deletedCount === 0) return json(res, 404, { ok: false, error: "Not Found" });
      return json(res, 200, { ok: true, id: String(_id) });
    }

    res.setHeader("Allow", "GET, POST, PUT, PATCH, DELETE");
    return json(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
};
