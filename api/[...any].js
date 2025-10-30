const express = require("express");
const { buildRouter, __ENDPOINTS } = require("../src/routes");

const app = express();
app.use(express.json({ limit: "1mb" }));

// Normalize routing behavior
app.set("case sensitive routing", false);
app.set("strict routing", false);

// Strip /api and normalize (collapse slashes, trim trailing, LOWERCASE)
app.use((req, _res, next) => {
  let u = req.url || "/";
  if (u.startsWith("/api")) u = u.slice(4) || "/";
  u = u.replace(/\/{2,}/g, "/");
  if (u.length > 1 && u.endsWith("/")) u = u.slice(0, -1);
  u = u.toLowerCase();
  req.url = u;
  next();
});

// Quick echo for ANY path when you add ?__echo=1
app.use((req, res, next) => {
  if (req.query && (req.query.__echo === "1" || req.query.__echo === 1)) {
    return res.json({
      ok: true,
      method: req.method,
      url: req.url,
      originalUrl: req.originalUrl,
      note: "This is after /api strip + normalization (lowercased).",
    });
  }
  next();
});

// Health/debug
app.get("/healthz", (_req, res) => res.json({ ok: true, from: "express-direct" }));
app.get("/__routes", (_req, res) =>
  res.json({ count: __ENDPOINTS?.length || 0, routes: __ENDPOINTS || [] })
);

// ***** APP-LEVEL CANARIES (before router) *****
// If either of these responds, Express path matching is fine.
app.all("/starfleet/ranks", (_req, res) =>
  res.json({ ok: true, layer: "app", path: "/starfleet/ranks", note: "App-level canary matched." })
);
app.all("/starfleet/ranks/", (_req, res) =>
  res.json({ ok: true, layer: "app", path: "/starfleet/ranks/", note: "App-level canary matched (slash)." })
);

// Mount dynamic Starfleet routes at root
app.use("/", buildRouter());

// Dump the full app stack (paths + methods)
app.get("/__stack", (_req, res) => {
  try {
    const stack = (app._router?.stack || [])
      .map((l) => {
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

// Fallback 404 (debug)
app.use((req, res) =>
  res.status(404).json({
    ok: false,
    error: "Not Found",
    path: req.originalUrl || req.url,
    note: "This is the Express fallback after all routes."
  })
);

module.exports = (req, res) => app(req, res);
