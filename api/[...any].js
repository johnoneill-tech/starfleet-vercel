const express = require("express");
const { buildRouter, __ENDPOINTS } = require("../src/routes");

const app = express();
app.use(express.json({ limit: "1mb" }));

app.set("case sensitive routing", false);
app.set("strict routing", false);

// Rebuild req.url from Vercel catch-all param or strip /api
app.use((req, _res, next) => {
  try {
    const u = new URL(req.originalUrl, "http://local");
    const names = ["...any", "any", "slug"];
    let captured = null;

    for (const n of names) {
      const val = u.searchParams.get(n);
      if (val != null) {
        const all = u.searchParams.getAll(n);
        captured = all.length > 1 ? all.join("/") : val;
        names.forEach(x => u.searchParams.delete(x));
        const rest = u.searchParams.toString();
        let rebuilt = `/${String(captured).replace(/^\/+/, "").toLowerCase()}${rest ? `?${rest}` : ""}`;
        rebuilt = rebuilt.replace(/\/{2,}/g, "/");
        if (rebuilt.length > 1 && rebuilt.endsWith("/")) rebuilt = rebuilt.slice(0, -1);
        req.url = rebuilt;
        return next();
      }
    }

    // No catch-all param; normalize and strip /api prefix if present
    let newUrl = req.originalUrl.startsWith("/api/")
      ? req.originalUrl.slice(4)
      : req.originalUrl;

    newUrl = newUrl.replace(/\/{2,}/g, "/");
    if (newUrl.length > 1 && newUrl.endsWith("/")) newUrl = newUrl.slice(0, -1);
    req.url = newUrl.toLowerCase();
  } catch {
    // leave req.url as-is
  }
  next();
});

// Minimal health + routes (useful in prod)
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/__routes", (_req, res) =>
  res.json({ count: __ENDPOINTS?.length || 0, routes: __ENDPOINTS || [] })
);

// Mount dynamic routes
app.use(buildRouter());

// Final 404
app.use((req, res) =>
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl || req.url })
);

module.exports = (req, res) => app(req, res);
