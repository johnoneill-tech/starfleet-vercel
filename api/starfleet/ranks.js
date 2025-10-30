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

  // Prepare a sandbox where `context` is available as a global (Realm-style)
  const sandbox = {
    exports: undefined,
    module: { exports: undefined },
    console,
    EJSON,
    context: realmContext,          // direct global
    globalThis: {},                 // we'll attach below
    global: {},                     // and here as well
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;

  vm.createContext(sandbox);
  new vm.Script(code, { filename: `${functionName}.js` }).runInContext(sandbox);

  const fn = sandbox.exports ?? sandbox.module.exports;
  if (typeof fn !== "function") {
    throw new Error(`Function not exported: ${functionName}`);
  }
  // Return both function and sandbox so calls can still resolve globals from the same context
  return { fn, sandbox };
}

// Try common Realm function signatures
async function invokeRealmFunction(fn, req, realmContext) {
  const payload = req.body ?? {};
  const query = req.query ?? {};
  const headers = req.headers ?? {};

  // Try signatures in order of likelihood; ignore errors until one works
  try { return await fn(payload, query, headers, realmContext); } catch {}
  try { return await fn(payload, query, realmContext); } catch {}
  try { return await fn(payload, realmContext); } catch {}
  try { return await fn(realmContext, payload, query, headers); } catch {}
  try { return await fn(realmContext, payload, query); } catch {}
  try { return await fn(payload); } catch {}

  // Last resort: no-arg style (purely global-based)
  return await fn();
}

module.exports = async (req, res) => {
  try {
    if (req.method.toUpperCase() !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    // Build Realm-like context first so it's available as a global during evaluation
    const db = await getDb();
    const realmContext = makeRealmContext(db);

    const { fn } = await loadRealmFunctionWithContext("Starfleet_ranks", realmContext);
    const result = await invokeRealmFunction(fn, req, realmContext);

    // Normal JSON for this endpoint
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
