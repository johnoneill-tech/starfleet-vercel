const path = require("node:path");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const { EJSON } = require("bson");
const { getDb } = require("../../src/db");
const { makeRealmContext } = require("../../src/realm_shim");

// Load Realm function with a sandbox that already has a GLOBAL `context`
async function loadRealmFunctionWithContext(functionName, realmContext) {
  const filePath = path.resolve(process.cwd(), "MDBScripts/functions", `${functionName}.js`);
  const code = await fs.readFile(filePath, "utf8");

  const sandbox = {
    exports: undefined,
    module: { exports: undefined },
    console,
    EJSON,
    context: realmContext,   // Realm-style global
    globalThis: null,
    global: null,
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;

  vm.createContext(sandbox);
  new vm.Script(code, { filename: `${functionName}.js` }).runInContext(sandbox);

  const fn = sandbox.exports ?? sandbox.module.exports;
  if (typeof fn !== "function") throw new Error(`Function not exported: ${functionName}`);
  return fn;
}

// Try common Realm function signatures
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

module.exports = async (req, res) => {
  try {
    if (req.method.toUpperCase() !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    const db = await getDb();
    const realmContext = makeRealmContext(db);

    const fn = await loadRealmFunctionWithContext("Starfleet_ranks", realmContext);
    const result = await invokeRealmFunction(fn, req, realmContext);

    return res.json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
