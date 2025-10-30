const path = require("node:path");
const fs = require("node:fs/promises");
const vm = require("node:vm");
const { EJSON } = require("bson");
const { getDb } = require("../../src/db");
const { makeRealmContext } = require("../../src/realm_shim");

// Load a Realm function from MDBScripts/functions/*.js via VM
async function loadRealmFunction(functionName) {
  const filePath = path.resolve(process.cwd(), "MDBScripts/functions", `${functionName}.js`);
  const code = await fs.readFile(filePath, "utf8");
  const sandbox = { exports: undefined, module: { exports: undefined }, console, EJSON };
  vm.createContext(sandbox);
  new vm.Script(code, { filename: `${functionName}.js` }).runInContext(sandbox);
  return sandbox.exports ?? sandbox.module.exports;
}

// Try the common Realm function signatures
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

module.exports = async (req, res) => {
  try {
    // Ensure correct HTTP method for this endpoint
    if (req.method.toUpperCase() !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    const fn = await loadRealmFunction("Starfleet_ranks");
    if (typeof fn !== "function") throw new Error("Function not exported: Starfleet_ranks");

    const db = await getDb();
    const context = makeRealmContext(db);
    const result = await invokeRealmFunction(fn, req, context);

    return res.json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
