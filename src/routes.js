// src/routes.js
const path = require("node:path");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const express = require("express");
const { EJSON } = require("bson");
const { getDb } = require("./db");
const { makeRealmContext } = require("./realm_shim");

// === Endpoints copied from your http_endpoints/config.js ===
const ENDPOINTS = [
  { route: "/Starfleet/systems",       http_method: "*",  function_name: "Systems",                            respond_result: true, return_type: "JSON" },
  { route: "/Starfleet/events",        http_method: "*",  function_name: "Starfleet_events",                   respond_result: true },
  { route: "/Starfleet/update",        http_method: "PUT",function_name: "modifiy_script",                     respond_result: true, return_type: "EJSON" },
  { route: "/Starfleet/classes",       http_method: "GET",function_name: "Starfleet_classes",                  respond_result: true },
  { route: "/Starfleet/login",         http_method: "*",  function_name: "Login",                              respond_result: true },
  { route: "/Starfleet/relationships", http_method: "*",  function_name: "Starfleet_personnel_relationships",  respond_result: true, return_type: "EJSON" },
  { route: "/Starfleet/ranks",         http_method: "GET",function_name: "Starfleet_ranks",                    respond_result: true },
  { route: "/Starfleet/photos",        http_method: "*",  function_name: "Starfleet_photos",                   respond_result: true },
  { route: "/Starfleet/personnel",     http_method: "*",  function_name: "Starfleet_personnel",                respond_result: true },
  { route: "/Starfleet/counts",        http_method: "GET",function_name: "counts",                             respond_result: true, return_type: "EJSON" },
  { route: "/Starfleet/starships",     http_method: "*",  function_name: "Starfleet_starships",                respond_result: true },
  { route: "/Starfleet/register",      http_method: "*",  function_name: "Register",                           respond_result: true },
];

function methodsFor(ep) {
  return ep.http_method === "*" ? ["get","post","put","patch","delete","options"] : [ep.http_method.toLowerCase()];
}

async function loadRealmFunctionFromFile(filePath) {
  const code = await fs.readFile(filePath, "utf8");
  const sandbox = { exports: undefined, module: { exports: undefined }, console, setTimeout, setInterval, clearTimeout, clearInterval };
  vm.createContext(sandbox);
  new vm.Script(code, { filename: path.basename(filePath) }).runInContext(sandbox);
  return sandbox.exports ?? sandbox.module.exports;
}

// Try several common Atlas Function signatures without you changing your files
async function invokeRealmFunction(fn, req, context) {
  const payload = req.body ?? {};
  const query   = req.query ?? {};
  const headers = req.headers ?? {};
  try { return await fn(payload, query, headers, context); } catch {}
  try { return await fn(payload, query, context); } catch {}
  try { return await fn(payload, context); } catch {}
  try { return await fn(context, payload, query, headers); } catch {}
  try { return await fn(context, payload, query); } catch {}
  return await fn(payload); // last resort
}

function buildRouter() {
  const router = express.Router();
  const functionsDir = path.resolve(process.cwd(), "MDBScripts/functions");

  for (const ep of ENDPOINTS) {
    const filePath = path.join(functionsDir, `${ep.function_name}.js`);

    const handler = async (req, res) => {
      try {
        const db = await getDb();                    // connect on first request only
        const context = makeRealmContext(db);        // minimal Realm-like shim
        const fn = await loadRealmFunctionFromFile(filePath);
        if (typeof fn !== "function") throw new Error(`Function not exported: ${ep.function_name}`);

        const result = await invokeRealmFunction(fn, req, context);
        if (ep.return_type === "EJSON") return res.type("application/json").send(EJSON.stringify(result));
        return res.json(result);
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    };

    for (const m of methodsFor(ep)) router[m](ep.route, handler);
  }

  return router;
}

module.exports = { buildRouter, __ENDPOINTS: ENDPOINTS };
