const express = require("express");
const { buildRouter, __ENDPOINTS } = require("../src/routes");

const app = express();
app.use(express.json({ limit: "1mb" }));

// Be forgiving with paths
app.set("case sensitive routing", false);
app.set("strict routing", false);

/**
 * Vercel catch-all quirk:
 * When this function is defined as api/[...any].js, requests like /api/starfleet/ranks
 * arrive with req.originalUrl = "/api/__stack?...any=starfleet/ranks" (example)
 * and the real path segment is in req.query["...any"].
 *
 * Reconstruct req.url from that when present so Express can match your routes.
 */
app.use((req, _res, next) => {
  const q = req.query || {};
  const capture = q["...any"] || q.any || q.slug; // support common names just in case
  if (capture) {
    const segs = Array.isArray(capture) ? capture : String(capture).split("/");
    const cleaned = segs.join("/").replace(/^\/+/, "");
    // Keep query string (minus the ...any param) if there are other keys
    const rest = new URL(req.originalUrl, "http://x").searchParams;
    rest.delete("...any"); rest.delete("any"); rest.delete("slug");
    const qs = rest.toString();
    req.url = `/${cleaned}${qs ? `?${qs}` : ""}`;
  }
  // Collapse duplicate slashes and make trailing slash non-significant
  req.url = req.url.replace(/\/{2,}/g, "/");
  if (req.url.length > 1 && req.url.endsWith("/")) req.url = req.url.slice(0, -1);
  next();
});

// Health/debug (these will match whether you call /api/healthz or /healthz)
app.get("/healthz", (_req, res) => res.json({ ok: true, from: "express-direct" }));
app.get("/__routes", (_req, res) =>
  res.json({ count: __ENDPOINTS?.length || 0, routes: __ENDPOINTS || [] })
);
app.all("/__echo", (req, res) => {
  res.json({
    ok: true,
    method: req.method,
    url: req.url,          // after reconstruction
    originalUrl: req.originalUrl
  });
});

// Mount your dynamic router once at root;
// reconstructed req.url already begins with "/starfleet/..."
app.use(buildRouter());

// App stack dump (for sanity checks)
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
