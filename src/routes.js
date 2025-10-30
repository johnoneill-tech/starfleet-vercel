const path = require("node:path");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const express = require("express");
const { EJSON } = require("bson");
const { getDb } = require("./db");
const { makeRealmContext } = require("./realm_shim");

// EXACT endpoints you provided (already lowercased)
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
    ? ["get", "post", "put", "patch", "delete", "options"]
    : [ep.http_method.toLowerCase()];
}

async function loadRealmFunctionFromFile(filePath) {
  const code = await fs.readFile(filePath, "utf8");
  const sandbox = { exports: undefined, module: { exports: undefined }, console, EJSON };
  vm.createContext(sandbox);
  new vm.Script(code, { filename: path.basename(filePath) }).runInContext(sandbox);
  return sandbox.exports ?? sandbox.module.exports;
}

// Try common Realm function signatures
async function invokeRealmFunction(fn, req, context) {
  const payload = req.body ?? {};
  const query = req.query ?? {};
  const headers = req.headers ?? {};
  try { return await fn(payload, query, headers, context); } catch {}
  try { return await fn(payload, query, context); } catch {}
  try { return await fn(payload, context); } catch {}
  try { return await fn(context, payload, query, headers); } catch {}
  try { return await fn(context, payload, query); } catch {}
  return await fn(payload);
}

function respond(res, result, ep) {
  // If the endpoint specifies EJSON, serialize with EJSON.stringify
  if ((ep.return_type || "").toUpperCase() === "EJSON") {
    res.type("application/json");
    // If result is already a string, assume it's EJSON; otherwise serialize it
    if (typeof result === "string") return res.send(result);
    return res.send(EJSON.stringify(result));
  }
  // Default: normal JSON
  return res.json(result);
}

function buildRouter() {
  const router = express.Router({ caseSensitive: false, strict: false });
  const functionsDir = path.resolve(process.cwd(), "MDBScripts/functions");

  for (const ep of ENDPOINTS) {
    const filePath = path.join(functionsDir, `${ep.function_name}.js`);

    const handler = async (req, res) => {
      try {
        const db = await getDb();
        const context = makeRealmContext(db);
        const fn = await loadRealmFunctionFromFile(filePath);
        if (typeof fn !== "function") throw new Error(`Function not exported: ${ep.function_name}`);

        const result = ep.respond_result
          ? await invokeRealmFunction(fn, req, context)
          : (await invokeRealmFunction(fn, req, context), { ok: true });

        return respond(res, result, ep);
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, function: ep.function_name, route: ep.route });
      }
    };

    for (const m of methodsFor(ep)) {
      router[m](ep.route, handler);
      router[m](`${ep.route}/`, handler); // tolerate trailing slash
    }
  }

  // Router probe for live verification
  router.get("/__router_probe", (_req, res) => {
    res.json({
      mounted: true,
      endpoints: ENDPOINTS.map(e => ({ route: e.route, methods: methodsFor(e), return_type: e.return_type || "JSON" }))
    });
  });

  return router;
}

module.exports = { buildRouter, __ENDPOINTS: ENDPOINTS };
