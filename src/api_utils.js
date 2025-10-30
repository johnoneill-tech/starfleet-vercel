const path = require("node:path");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const { EJSON, ObjectId, BSON } = require("bson");
const { getDb } = require("./db");
const { makeRealmContext } = require("./realm_shim");

// Build a Realm-like payload object (providing body.text(), query, headers)
function makeRealmPayload(req) {
  const query = req.query || {};
  const headers = req.headers || {};
  const rawBody = typeof req.body === "string" ? req.body : (req.body ? JSON.stringify(req.body) : "");
  return {
    query,
    headers,
    body: {
      text: () => rawBody || ""
    }
  };
}

// Ensure context.request exists and mirrors the incoming HTTP request
function attachRequestToContext(ctx, req) {
  ctx.request = {
    httpMethod: (req.method || "GET").toUpperCase(),
    headers: req.headers || {},
    query: req.query || {},
    body: { text: () => (typeof req.body === "string" ? req.body : (req.body ? JSON.stringify(req.body) : "")) }
  };
  return ctx;
}

// Load a Realm function file and evaluate with a sandbox that has GLOBAL context, EJSON, BSON/ObjectId
async function loadRealmFunction(functionName, realmContext) {
  const filePath = path.resolve(process.cwd(), "MDBScripts/functions", `${functionName}.js`);
  const code = await fs.readFile(filePath, "utf8");

  const sandbox = {
    exports: undefined,
    module: { exports: undefined },
    console,
    EJSON,
    BSON: { ObjectId }, // functions use BSON.ObjectId(...)
    ObjectId,           // in case code references ObjectId directly
    context: realmContext
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;

  vm.createContext(sandbox);
  new vm.Script(code, { filename: `${functionName}.js` }).runInContext(sandbox);

  const fn = sandbox.exports ?? sandbox.module.exports;
  if (typeof fn !== "function") throw new Error(`Function not exported: ${functionName}`);
  return fn;
}

// Try common Realm function signatures in order
async function invokeRealmFunction(fn, req, realmContext) {
  const payload = makeRealmPayload(req);
  const query = payload.query;
  const headers = payload.headers;

  try { return await fn(payload, { /* response shim (unused) */ }); } catch {}
  try { return await fn(payload, query, headers, realmContext); } catch {}
  try { return await fn(payload, query, realmContext); } catch {}
  try { return await fn(payload, realmContext); } catch {}
  try { return await fn(realmContext, payload, query, headers); } catch {}
  try { return await fn(realmContext, payload, query); } catch {}
  try { return await fn(payload); } catch {}
  return await fn(); // pure global usage
}

/** Serialize response (EJSON when requested) */
function send(res, status, data, returnType = "JSON") {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  if ((returnType || "JSON").toUpperCase() === "EJSON") {
    if (typeof data === "string") return res.end(data);
    return res.end(EJSON.stringify(data));
  }
  return res.end(typeof data === "string" ? data : JSON.stringify(data));
}

/** Factory to make a Vercel handler for one endpoint */
function makeHandler({ function_name, methods = "*", return_type = "JSON" }) {
  const allowed = methods === "*" ? ["GET","POST","PUT","PATCH","DELETE","OPTIONS"] : methods.map(m => m.toUpperCase());

  return async (req, res) => {
    try {
      const method = (req.method || "GET").toUpperCase();
      if (!allowed.includes(method)) {
        res.setHeader("Allow", allowed.join(", "));
        return send(res, 405, { ok: false, error: "Method Not Allowed" });
      }

      // Ensure req.body is captured (fallback for raw body)
      if (!req.body && typeof req.headers?.["content-type"] === "string" && req.headers["content-type"].includes("application/json")) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString("utf8");
        req.body = raw || "";
      }

      const db = await getDb();
      const ctx = attachRequestToContext(makeRealmContext(db), req);
      const fn = await loadRealmFunction(function_name, ctx);
      const result = await invokeRealmFunction(fn, req, ctx);

      return send(res, 200, result, return_type);
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message, function: function_name });
    }
  };
}

module.exports = { makeHandler };
