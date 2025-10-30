// api/starfleet/photos.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

/* ------------ tiny utils ------------ */
function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function parseUrl(req) {
  try {
    return new URL(req.url || req.originalUrl || "/", "http://local");
  } catch {
    return new URL("/", "http://local");
  }
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body; // sometimes provided by platform
  if (req.body && typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function toObjectId(id, field = "id") {
  try { return new ObjectId(String(id)); }
  catch { throw new Error(`Invalid ${field}: must be a 24-hex ObjectId string`); }
}

/* ------------ handler ------------ */
module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();

  try {
    const db = await getDb();
    const col = db.collection("photos");

    // ROUTING
    if (method === "GET") {
      const u = parseUrl(req);
      const id = u.searchParams.get("id");
      const subject_id = u.searchParams.get("subject_id");
      const limit = Math.max(0, Math.min(parseInt(u.searchParams.get("limit") || "50", 10), 200));
      const page = Math.max(0, parseInt(u.searchParams.get("page") || "0", 10));
      const skip = page * limit;

      // GET by id → single URL (and id for convenience)
      if (id) {
        const _id = toObjectId(id, "id");
        const doc = await col.findOne({ _id }, { projection: { _id: 1, url: 1 } });
        if (!doc) return json(res, 404, { ok: false, error: "Not Found" });
        return json(res, 200, { ok: true, id: String(doc._id), url: doc.url || null });
      }

      // GET list by subject_id → array of URLs (id optional in query param controls)
      const filter = {};
      if (subject_id) filter.subject_id = toObjectId(subject_id, "subject_id");

      // only return string, non-empty urls
      const cursor = col
        .find(filter, { projection: { _id: 1, url: 1 } })
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit);

      const docs = await cursor.toArray();
      // By default return just URLs; if you ever need ids too, flip the map below
      const urls = docs.map(d => d?.url).filter(u => typeof u === "string" && u.length > 0);
      return json(res, 200, urls);
    }

    if (method === "POST") {
      const body = await readJsonBody(req);
      const url = (body.url || "").trim();
      if (!url) return json(res, 400, { ok: false, error: "url is required" });

      let subject_id = null;
      if (body.subject_id) subject_id = toObjectId(body.subject_id, "subject_id");

      const doc = { url };
      if (subject_id) doc.subject_id = subject_id;
      if (typeof body.caption === "string") doc.caption = body.caption;
      if (typeof body.source === "string") doc.source = body.source;
      if (Array.isArray(body.tags)) doc.tags = body.tags.filter(t => typeof t === "string" && t.length > 0);

      // Optional: timestamps
      const now = new Date();
      doc.created_at = now;
      doc.updated_at = now;

      const r = await col.insertOne(doc);
      return json(res, 201, { ok: true, id: String(r.insertedId), url: doc.url });
    }

    if (method === "PUT" || method === "PATCH") {
      const body = await readJsonBody(req);
      if (!body.id) return json(res, 400, { ok: false, error: "id is required" });
      const _id = toObjectId(body.id, "id");

      const $set = { updated_at: new Date() };
      if (typeof body.url === "string") $set.url = body.url.trim();
      if (typeof body.caption === "string") $set.caption = body.caption;
      if (typeof body.source === "string") $set.source = body.source;
      if (Array.isArray(body.tags)) $set.tags = body.tags.filter(t => typeof t === "string" && t.length > 0);
      if (body.subject_id !== undefined) {
        $set.subject_id = body.subject_id ? toObjectId(body.subject_id, "subject_id") : undefined;
      }

      // remove undefined fields from $set
      Object.keys($set).forEach(k => $set[k] === undefined && delete $set[k]);

      if (Object.keys($set).length === 1) { // only updated_at present
        return json(res, 400, { ok: false, error: "No updatable fields provided" });
      }

      const r = await col.updateOne({ _id }, { $set });
      if (r.matchedCount === 0) return json(res, 404, { ok: false, error: "Not Found" });

      // return the updated url (convenience)
      const doc = await col.findOne({ _id }, { projection: { _id: 1, url: 1 } });
      return json(res, 200, { ok: true, id: String(_id), url: doc?.url || null });
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

    // Method not allowed
    res.setHeader("Allow", "GET, POST, PUT, PATCH, DELETE");
    return json(res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
};
