const path = require("node:path");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const { EJSON } = require("bson");
const { getDb } = require("../src/db");
const { makeRealmContext } = require("../src/realm_shim");

// Keep this in sync with src/routes.js or import from there if you prefer.
// Using your exact list:
const ENDPOINTS = [
  { route: "/starfleet/systems",       http_method: "*",   function_name: "Systems",                           respond_result: true, return_type: "JSON" },
  { route: "/starfleet/events",        http_method: "*",   function_name: "Starfleet_events",                  respond_result: true },
  { route: "/starfleet/update",        http_method: "PUT", function_name: "modifiy_script",                    respond_result: true, return_type: "EJSON" },
  { route: "/starfleet/classes",       http_method: "GET", function_name: "Starfleet_classes",                 respond_result: true },
  { route: "/starfleet/login",         http_method: "*",   function_name: "Login",                             respond_result: true },
  { route: "/starfleet/relationships", http_method: "*",   function_name: "Starfleet_personnel_relationships", respond_result: true, return_type: "EJSON" },
  { route: "/starfleet/ranks",         http_method: "GET", function_name: "Starfleet_ranks",                   respond_result: true },
  { route: "/starfleet/photos",        http_method: "*",   function_name: "Starfleet_photos",                  respond_result: true },
  { route: "/starfleet/personnel",     http_method: "*",   function_name: "Starfleet_personnel",               respond_result: true },
  { route: "/starfleet/counts",        http_method: "GET", function_name: "counts",                            respond_result: true, return_type: "EJSON" },
  { route: "/starfleet/starships",     http_method: "*",   function_name: "Starfleet_starships",               respond_result: true },
  { route: "/starfleet/register",      http_method: "*",   function_name: "Register",                          respond_result: true },
];

function methodsFor(ep) {
  return ep.http_method === "*"
    ? ["get","post","put","patch","delete","options"]
    : [ep.http_method.toLowerCase()];
}

function normalizePath(p) {
  if (!p) return "/";
  let s = p.replace(/\/{2,}/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/** Extract the intended path from Vercel catch-all invocation. */
function extractPath(req) {
  // 1) If Vercel passed segments via ...any/any/slug, use that.
  try {
    const u = new URL(req.url || req.originalUrl || "/", "http://local");
    const names = ["...any", "any", "slug"];
    for (const n of names) {
      const vals = u.searchParams.getAll(n);
      if (vals && vals.length) {
        const captured = vals.join("/");
        names.forEach(x => u.searchParams.delete(x));
        const qs = u.searchParams.toString();
        const rebuilt = `/${String(captured).replace(/^\/+/, "")}${qs ? `?${qs}` : ""}`;
        return normalizePath(rebuilt.split("?")[0]);
      }
    }
  } catch {}

  // 2) Otherwise, if called as /api/xxx, strip the /api prefix.
  const orig = req.url || req.originalUrl || "/";
  if (orig.startsWith("/api/")) return normalizePath(orig.slice(4).split("?")[0]);

  // 3) Fallback: just the path portion.
  try {
    const u = new URL(orig, "http://local");
    return normalizePath(u.pathname);
  } catch {
    return normalizePath(orig.split("?")[0]);
  }
}

async function loadRealmFunction(functionName, realmContext) {
  const filePath = path.resolve(process.cwd(), "MDBScripts/functions", `${functionName}.js`);
  const code = await fs.readFile(filePath, "utf8");
  const sandbox = {
    exports: undefined,
    module: { exports: undefined },
    console,
    EJSON,
    context: realmContext, // global Realm context for scripts that reference it
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;

  vm.createContext(sandbox);
  new vm.Script(code, { filename: `${functionName}.js` }).runInContext(sandbox);

  const fn = sandbox.exports ?? sandbox.module.exports;
  if (typeof fn !== "function") {
    throw new Error(`Function not exported: ${functionName}`);
  }
  return fn;
}

async function invokeRealmFunction(fn, req, realmContext) {
  const payload = req.body ?? {};
  const query = req.query ?? {};
  const headers = req.headers ?? {};
  try { return await fn(payload, query, headers, realmContext); } catch {}
  try { return await fn(payload, query, realmContext); } catch {}
  try { return await fn(payload, realmContext); } catch {}
  try { return await fn(realmContext, payload, query, headers); } catch {}
  try { return await fn(realmContext, payload, query); } catch {}
  try { return await fn(payload); } catch {}
  return await fn(); // pure global usage
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function respond(res, result, ep) {
  const rt = (ep.return_type || "JSON").toUpperCase();
  if (rt === "EJSON") {
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (typeof result === "string") return res.end(result);
    return res.end(EJSON.stringify(result));
  }
  return send(res, 200, result);
}

module.exports = async (req, res) => {
  try {
    // Parse JSON body if any (Vercel gives raw req for node/expressless handlers)
    if (req.method !== "GET" && req.headers["content-type"]?.includes("application/json")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw) {
        try { req.body = JSON.parse(raw); } catch { req.body = raw; }
      }
    }

    // Normalize method/path
    const method = (req.method || "GET").toLowerCase();
    const pathOnly = extractPath(req); // e.g., "/starfleet/ranks"

    // Health + routes (kept minimal, since you use them)
    if (pathOnly === "/healthz") return send(res, 200, { ok: true });
    if (pathOnly === "/__routes") {
      return send(res, 200, { count: ENDPOINTS.length, routes: ENDPOINTS });
    }

    // Find endpoint (case-insensitive path match)
    const ep = ENDPOINTS.find(e => e.route.toLowerCase() === pathOnly.toLowerCase());
    if (!ep) return send(res, 404, { ok: false, error: "Not Found", path: pathOnly });

    // Check method
    const allowed = methodsFor(ep);
    if (!allowed.includes(method)) {
      res.setHeader("Allow", allowed.map(m => m.toUpperCase()).join(", "));
      return send(res, 405, { ok: false, error: "Method Not Allowed", path: pathOnly, method: method.toUpperCase() });
    }

    // Build Realm context and load/invoke function
    const db = await getDb();
    const realmContext = makeRealmContext(db);
    const fn = await loadRealmFunction(ep.function_name, realmContext);

    const result = ep.respond_result
      ? await invokeRealmFunction(fn, req, realmContext)
      : (await invokeRealmFunction(fn, req, realmContext), { ok: true });

    return respond(res, result, ep);
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
