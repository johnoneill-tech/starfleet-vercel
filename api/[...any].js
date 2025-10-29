const serverless = require("serverless-http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { buildRouter } = require("../src/routes");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: true }));
app.use(helmet());

app.get("/api/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/_debug/ok", (_req, res) => res.json({ ok: true, from: "express" }));

app.use(buildRouter());

module.exports = serverless(app);
