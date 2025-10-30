const express = require("express");
const { buildRouter, __ENDPOINTS } = require("../src/routes");

const app = express();
app.use(express.json({ limit: "1mb" }));

// Relax matching a bit
app.set("case sensitive routing", false);
app.set("strict routing", false);

/**
 * Rebuild req.url from Vercel catch-all query param.
 * In api/[...any].js deployments, Vercel often forwards requests like:
 *   /api/starfleet/ranks  ->  originalUrl="/api/__whatever?...any=starfleet/ranks"
 * (or sometimes "any"/"slug"). We reconstruct the path so Express can match.
 */
app.use((req, _res, next) => {
  try {
    const url = new URL(req.originalUrl, "http://local");
    // Look for common catch-all param names
    let captured =
      url.searchParams.get("...any") ??
      url.searchParams.get("any") ??
      url.searchParams.get("slug");

    if (captured) {
      // If multiple values were sent, join them as a path
      const all = url.searchParams.getAll("...any")
        .concat(url.searchParams.getAll("any"))
        .concat(url.searchParams.getAll("slug"));
      if (all.length > 1) captured = all.join("/");
      // Normalize, lower-case to match endpoints (which are lowercased)
      const seg = String(captured).replace(/^\/+/, "");
      // Preserve any *other* query params
      url.searchParams.delete("...any");
      url.searchParams.delete("any");
      url.searchParams.delete("slug");
      const rest = url.searchParams.toString();
      req.url = `/${seg.toLowerCase()}${rest ? `?${rest}` : ""}`;
    } else {
      // No catch-all param; if we came in as /api/..., strip only the /api prefix for Express app
      if (req.originalUrl.startsWith("/api/")) {
        req.url = req.originalUrl.slice(4) || "/";
      } else {
        req.url = req.originalUrl || "/";
      }
      // Normalize slashes & trailing slash
      req.url = req.url.replace(/\/{2,}/g, "/");
      if (req.url.length > 1 && req.url.endsWith("/")) req.url = req.url.slice(0, -1);
    }
  } catch {
    // Fallback: ensure req.url is usable
    req.url = req.url || "/";
  }
  next();
});

// Health/debug (work whether you call /api/... or /...)
app.get("/healthz", (_req, res) => res.json({ ok: true, from: "express-direct" }));
app.get("/__routes", (_req, res) =>
  res.json({ count: __ENDPOINTS?.length || 0, routes: __ENDPOINTS || [] })
);
app.all("/__echo", (req, res) => {
  res.json({
    ok: true,
    method: req.method,
    url: req.url,          // after reconstruction/normalization
    originalUrl: req.originalUrl
  });
});

// Mount your dynamic router at root (req.url now starts with e.g. /starfleet/ranks)
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
