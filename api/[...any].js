// api/[...any].js
const express = require("express");
const { buildRouter, __ENDPOINTS } = require("../src/routes");

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use((req, _res, next) => {
  if (req.url.startsWith("/api")) {
    req.url = req.url.slice(4) || "/"; // remove "/api"
  }
  next();
});

app.get("/healthz", (_req, res) => res.json({ ok: true, from: "express-direct" }));
app.get("/__routes", (_req, res) => res.json({ count: __ENDPOINTS?.length || 0, routes: __ENDPOINTS || [] }));

// TEMP probe: should respond at /api/Starfleet/ranks
app.get("/Starfleet/ranks", (_req, res) => {
  res.json({ ok: true, probe: "static /Starfleet/ranks matched" });
});

app.use(buildRouter());

app.use((_req, res) => res.status(404).json({ ok: false, error: "Not Found", path: _req.path }));

module.exports = (req, res) => app(req, res);
