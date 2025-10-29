const serverless = require("serverless-http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { buildRouter } = require("../src/routes");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: true }));
app.use(helmet());

// Health / debug (NOTE: no "/api" prefix here)
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/_debug/ok", (_req, res) => res.json({ ok: true, from: "express" }));

// Optional: quick visibility into the route table
app.get("/__routes", (_req, res) => {
  try {
    const { __ENDPOINTS } = require("../src/routes");
    res.json({ endpoints: __ENDPOINTS || [] });
  } catch {
    res.json({ endpoints: "not exported" });
  }
});

// Mount your /Starfleet/* routes (these keep their leading /Starfleet)
app.use(buildRouter());

// Fallbacks
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found", path: req.path }));
app.use((err, _req, res, _next) => {
  res.status(500).json({ ok: false, error: err?.message || "Internal Error" });
});

// Export handler
module.exports = serverless(app);
