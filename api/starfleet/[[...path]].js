// api/starfleet/[[...path]].js
// One Lambda to rule them all: auto-load handlers from src/routes/*.js
// URL: /api/starfleet/<name>  -> src/routes/<name>.js (module.exports = async (req,res)=>{})

const fs = require("fs");
const path = require("path");
const url = require("url");

// --- CORS (centralized) ---
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function writeJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

// --- Auto-discover all ./src/routes/*.js at cold start ---
const ROUTES_DIR = path.join(process.cwd(), "src", "routes");
const routeTable = Object.create(null);

try {
  const files = fs.readdirSync(ROUTES_DIR, { withFileTypes: true });
  for (const f of files) {
    if (f.isFile() && f.name.endsWith(".js")) {
      const name = f.name.slice(0, -3).toLowerCase(); // "events.js" -> "events"
      // Lazy require via getter so Vercel bundling stays happy
      Object.defineProperty(routeTable, name, {
        enumerable: true,
        get: () => require(path.join(ROUTES_DIR, f.name)),
      });
    }
  }
} catch (e) {
  // If the folder doesn't exist in some env, fail gracefully
  // (you'll still get a 404 below if a route is requested)
}

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  // Parse the first segment after /api/starfleet/
  const parsed = url.parse(req.url, true);
  const base = "/api/starfleet/";
  const fullPath = parsed.pathname || "";
  const sub = fullPath.startsWith(base) ? fullPath.slice(base.length) : "";
  const seg = (sub.split("/")[0] || "").toLowerCase(); // e.g. "events"

  // Resolve handler
  const handler = routeTable[seg];
  if (!handler) {
    return writeJSON(res, 404, { message: `Route not found: ${seg || "(root)"}` });
  }

  try {
    // Handlers export: module.exports = async (req,res)=>{...}
    return await handler(req, res);
  } catch (e) {
    return writeJSON(res, 500, { message: e.message || "Internal error" });
  }
};
