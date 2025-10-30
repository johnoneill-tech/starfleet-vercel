const path = require("node:path");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const express = require("express");
const { EJSON } = require("bson");
const { getDb } = require("./db");
const { makeRealmContext } = require("./realm_shim");

// EXACT endpoints you provided (lowercased paths recommended; router is case-insensitive)
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

// Load Realm function with GLOBAL `context` in the sandbox
async function loadRealmFunctionFromFile(filePath, realmContext) {
  const code = await fs.readFile(filePath, "utf8");
  const sandbox = {
    exports: undefined,
    module: { exports: undefined },
    console,
    EJSON,
    context: realmContext, // Realm-style global
  };
  // Ensure globalThis/global refer to the same sandbox so "globalThis.context" also works
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;

  vm.createContext(sandbox);
  new vm.Script(code, { filename: path.basename(filePath) }).runInContext(sandbox);

  const fn = sandbox.exports ?? sandbox.module.exports;
  if (typeof fn !== "function") {
    throw new Error(`Function not exported: ${path.basename(filePath)}`);
  }
  return fn;
}

// Try common Realm function signatures & fallbacks
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

function respond(res, result, ep) {
  const rt = (ep.return_type || "JSON").toUpperCase();
  if (rt === "EJSON") {
    res.type("application/json");
    if (typeof result === "string") return res.send(result);
    return res.send(EJSON.stringify(result));
  }
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
        const realmContext = makeRealmContext(db); // create before load so global exists during eval
        const fn = await loadRealmFunctionFromFile(filePath, realmContext);

        const result = ep.respond_result
          ? await invokeRealmFunction(fn, req, realmContext)
          : (await invokeRealmFunction(fn, req, realmContext), { ok: true });

        return respond(res, result, ep);
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, function: ep.function_name, route: ep.route });
      }
    };

    for (const m of methodsFor(ep)) {
      router[m](ep.route, handler);
      router[m](`${ep.route}/`, handler); // accept trailing slash
    }
  }

  return router;
}

module.exports = { buildRouter, __ENDPOINTS: ENDPOINTS };
