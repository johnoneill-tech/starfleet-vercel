// api/starfleet/starships.js
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

function timeframeMatch(tf) {
  if (!tf) return {};
  if (tf === "22nd") return { ship_id: { $lt: 400 } };
  if (tf === "23rd") return { ship_id: { $gte: 400, $lt: 2500 } };
  if (tf === "24th") return { ship_id: { $gte: 2500, $lt: 110000 } };
  if (tf === "32nd") return { ship_id: { $gte: 110000 } };
  return {};
}

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  try {
    const db = await getDb();
    const col = db.collection("starships");

    if (method === "GET") {
      const u = parseUrl(req);
      const id = u.searchParams.get("id");
      const name = (u.searchParams.get("name") || "").trim();    // prefix on name
      const klass = (u.searchParams.get("class") || "").trim();  // All / Unknown / exact
      const timeframe = (u.searchParams.get("timeframe") || "").trim(); // 22nd/23rd/24th/32nd

      const perPage = Math.max(1, Math.min(parseInt(u.searchParams.get("starshipsPerPage") || "12", 10), 200));
      const page = Math.max(0, parseInt(u.searchParams.get("page") || "0", 10));
      const skip = page * perPage;

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

      // Build filter
      const filter = {};
      if (name) filter.name = { $regex: "^" + escRe(name) + ".*", $options: "i" }; // prefix
      if (klass) {
        if (klass === "All") {
          // no class constraint
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
      Object.assign(filter, timeframeMatch(timeframe));

      const docs = await col.aggregate([
        { $match: filter },
        { $sort: { ship_id: 1, _id: 1 } },
        { $skip: skip },
        { $limit: perPage },
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

      const items = docs.map(d => ({
        id: String(d._id),
        name: d.name,
        class: d.class,
        registry: d.registry,
        ship_id: d.ship_id,
        picUrl: d.picUrl
      }));
      return json(res, 200, items);
    }

    // Mutations preserved from earlier (POST/PUT/PATCH/DELETE)
    if (method === "POST") {
      const body = await readJsonBody(req);
      const name = (body.name || "").trim();
      if (!name) return json(res, 400, { ok: false, error: "name is required" });

      const doc = { name, created_at: new Date(), updated_at: new Date() };
      if (typeof body.class === "string") doc.class = body.class.trim();
      if (typeof body.registry === "string") doc.registry = body.registry.trim();
      if (typeof body.ship_id === "number") doc.ship_id = body.ship_id;
      if (typeof body.notes === "string") doc.notes = body.notes;

      const r = await col.insertOne(doc);
      return json(res, 201, { ok: true, id: String(r.insertedId), name: doc.name });
    }

    if (method === "PUT" || method === "PATCH") {
      const body = await readJsonBody(req);
      if (!body.id) return json(res, 400, { ok: false, error: "id is required" });
      const _id = toObjectId(body.id, "id");

      const $set = { updated_at: new Date() };
      if (typeof body.name === "string") $set.name = body.name.trim();
      if (typeof body.class === "string") $set.class = body.class.trim();
      if (typeof body.registry === "string") $set.registry = body.registry.trim();
      if (typeof body.ship_id === "number") $set.ship_id = body.ship_id;
      if (typeof body.notes === "string") $set.notes = body.notes;

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
