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

module.exports = serverless(app);
