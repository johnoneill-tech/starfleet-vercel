const serverless = require("serverless-http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { buildRouter } = require("../src/routes");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: true }));
app.use(helmet());

// Optional API key guard (recommended)
app.use((req, res, next) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return next();
  if (req.header("x-api-key") === apiKey) return next();
  return res.status(401).json({ ok: false, error: "Unauthorized" });
});

app.use(buildRouter());

app.get("/api/healthz", (_req, res) => res.json({ ok: true }));

// List the routes we registered from src/routes.js
app.get("/api/_debug/routes", (_req, res) => {
  const { buildRouter } = require("../src/routes");
  // Rebuild router and read the endpoints array directly:
  const endpoints = require("../src/routes").__ENDPOINTS || [];
  res.json({ endpoints });
});

// Check if the function file is in the bundle
app.get("/api/_debug/fs", async (_req, res) => {
  const fs = require("node:fs");
  const path = require("node:path");
  const p = path.resolve(process.cwd(), "MDBScripts/functions/Starfleet_ranks.js");
  res.json({ cwd: process.cwd(), exists: fs.existsSync(p), path: p });
});

app.get("/api/_debug/ok", (_req, res) => res.json({ ok: true, from: "express" }));

module.exports = serverless(app);
