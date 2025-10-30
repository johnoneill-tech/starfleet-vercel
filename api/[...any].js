const express = require("express");
const { buildRouter, __ENDPOINTS } = require("../src/routes");

const app = express();
app.use(express.json({ limit: "1mb" }));

// Relax matching a bit
app.set("case sensitive routing", false);
app.set("strict routing", false);

// Health/debug (available under both / and /api/ because we mount the router twice below)
app.get("/healthz", (_req, res) => res.json({ ok: true, from: "express-direct" }));
app.get("/__routes", (_req, res) =>
  res.json({ count: __ENDPOINTS?.length || 0, routes: __ENDPOINTS || [] })
);

// Echo what Express actually sees for this function invocation
app.all("/__echo", (req, res) => {
  res.json({
    ok: true,
    method: req.method,
    url: req.url,              // what Express is matching on
    originalUrl: req.originalUrl
  });
});

// Mount Starfleet router at BOTH "/" and "/api"
// This covers both cases: when Vercel includes "/api" in req.url and when it doesn't.
const router = buildRouter();
app.use("/", router);
app.use("/api", router);

// Dump the full app stack for inspection
app.get("/__stack", (_req, res) => {
  try {
    const stack = (app._router?.stack || [])
      .map(l => {
        if (l.route) {
          const methods = Object.keys(l.route.methods || {}).filter(Boolean);
          return { path: l.route.path, methods };
        }
        if (l.name === "router" && l.handle?.stack) {
          return l.handle.stack
            .filter(s => s.route)
            .map(s => ({
              path: s.route.path,
              methods: Object.keys(s.route.methods || {}).filter(Boolean),
            }));
        }
        return null;
      })
      .flat()
      .filter(Boolean);
    res.json({ ok: true, stack });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Fallback 404
app.use((req, res) =>
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl || req.url })
);

module.exports = (req, res) => app(req, res);
