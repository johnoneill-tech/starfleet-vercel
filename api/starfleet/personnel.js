// api/starfleet/personnel.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

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

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  try {
    const db = await getDb();
    const col = db.collection("officers");

    if (method === "GET") {
      const u = parseUrl(req);
      const id = u.searchParams.get("id");
      const search = (u.searchParams.get("search") || "").trim();
      const limit = Math.max(0, Math.min(parseInt(u.searchParams.get("limit") || "50", 10), 200));
      const page = Math.max(0, parseInt(u.searchParams.get("page") || "0", 10));
      const skip = page * limit;

      if (id) {
        const _id = toObjectId(id, "id");
        const doc = await col.findOne(
          { _id },
          { projection: { _id: 1, name: 1, rank: 1, division: 1 } }
        );
        if (!doc) return json(res, 404, { ok: false, error: "Not Found" });
        return json(res, 200, { ok: true, id: String(doc._id), name: doc.name, rank: doc.rank, division: doc.division });
      }

      const filter = {};
      if (search) filter.name = { $regex: search, $options: "i" }; // CONTAINS match

      const docs = await col
        .find(filter, { projection: { _id: 1, name: 1, rank: 1, division: 1 } })
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const items = docs.map(d => ({ id: String(d._id), name: d.name, rank: d.rank, division: d.division }));
      return json(res, 200, items);
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
