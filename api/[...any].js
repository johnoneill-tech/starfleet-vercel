const express = require("express");
const { buildRouter, __ENDPOINTS } = require("../src/routes");

const app = express();
app.use(express.json({ limit: "1mb" }));

// Normalize routing behavior
app.set("case sensitive routing", false);
app.set("strict routing", false);

// Strip /api prefix (Vercel adds it) and normalize the path
app.use((req, _res, next) => {
  if (req.url.startsWith("/api")) req.url = req.url.slice(4) || "/";
  // collapse multiple slashes
  req.url = req.url.replace(/\/{2,}/g, "/");
  // drop trailing slash (except root)
  if (req.url.length > 1 && req.url.endsWith("/")) req.url = req.url.slice(0, -1);
  next();
});

// Health/debug
app.get("/healthz", (_req, res) => res.json({ ok: true, from: "express-direct" }));
app.get("/__routes", (_req, res) =>
  res.json({ count: __ENDPOINTS?.length || 0, routes: __ENDPOINTS || [] })
);

// Mount dynamic Starfleet routes at root
app.use("/", buildRouter());

// Optional app-level canary for path matching (passes through to router)
app.get("/Starfleet/ranks", (_req, _res, next) => next());

// Fallback 404 (debug)
app.use((req, res) =>
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl || req.url })
);

module.exports = (req, res) => app(req, res);
