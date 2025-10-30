const express = require("express");
const { buildRouter, __ENDPOINTS } = require("../src/routes");

const app = express();
app.use(express.json({ limit: "1mb" }));

app.set("case sensitive routing", false);
app.set("strict routing", false);

/**
 * If Vercel put the matched segments in a catch-all query param, rebuild req.url from it.
 * Otherwise, leave req.url as Express received it (which may already be "/api/..." or "/...").
 */
app.use((req, _res, next) => {
  try {
    const o = req.originalUrl || req.url || "/";
    const u = new URL(o, "http://local");
    // Vercel may use "...any", "any", or "slug"
    const names = ["...any", "any", "slug"];

    let captured = null;
    let used = null;

    for (const n of names) {
      const vals = u.searchParams.getAll(n);
      if (vals && vals.length) {
        captured = vals.join("/");
        used = n;
        // Remove the catch-all params from the query we’ll forward
        u.searchParams.delete(n);
      }
    }

    if (captured) {
      // Decode and normalize the reconstructed path
      const seg = decodeURIComponent(String(captured)).replace(/^\/+/, "");
      const rest = u.searchParams.toString();
      let rebuilt = `/${seg}${rest ? `?${rest}` : ""}`;
      rebuilt = rebuilt.replace(/\/{2,}/g, "/");
      if (rebuilt.length > 1 && rebuilt.endsWith("/")) rebuilt = rebuilt.slice(0, -1);
      req.url = rebuilt;
    } else {
      // No catch-all parameter. If the function is invoked at /api/..., strip only the leading "/api".
      if (o.startsWith("/api/")) {
        let stripped = o.slice(4);
        stripped = stripped.replace(/\/{2,}/g, "/");
        if (stripped.length > 1 && stripped.endsWith("/")) stripped = stripped.slice(0, -1);
        req.url = stripped;
      } else {
        // Leave it as-is (Express already has a proper path)
        req.url = req.url || "/";
      }
    }
  } catch {
    // If any parsing fails, leave req.url alone and continue
  }
  next();
});

// Minimal health + route listing (kept by request)
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/__routes", (_req, res) =>
  res.json({ count: __ENDPOINTS?.length || 0, routes: __ENDPOINTS || [] })
);

// Mount dynamic routes (single mount; req.url is now correct for the router)
app.use(buildRouter());

// Final 404
app.use((req, res) =>
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl || req.url })
);

module.exports = (req, res) => app(req, res);
