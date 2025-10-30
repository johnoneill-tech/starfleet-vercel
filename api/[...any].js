const express = require("express");
const { buildRouter, __ENDPOINTS } = require("../src/routes");

const app = express();
app.use(express.json({ limit: "1mb" }));

// Relax matching (case-insensitive, ignore trailing slash)
app.set("case sensitive routing", false);
app.set("strict routing", false);

// Minimal health + routes
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/__routes", (_req, res) =>
  res.json({ count: __ENDPOINTS?.length || 0, routes: __ENDPOINTS || [] })
);

// Build the Starfleet router once…
const router = buildRouter();

// …and mount it at BOTH roots to avoid any /api prefix ambiguity
app.use("/", router);
app.use("/api", router);

// Final 404
app.use((req, res) =>
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl || req.url })
);

module.exports = (req, res) => app(req, res);
