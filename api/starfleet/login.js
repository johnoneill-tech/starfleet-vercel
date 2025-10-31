// api/starfleet/login.js
const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");

const jwt = require("jsonwebtoken");
const passwordHash = require("password-hash");

/* tiny utils */
function readJSON(bodyOrReq) {
  if (bodyOrReq && typeof bodyOrReq === "object" && !Buffer.isBuffer(bodyOrReq)) return bodyOrReq;
  return new Promise((resolve) => {
    if (!bodyOrReq || typeof bodyOrReq.on !== "function") return resolve({});
    const chunks = [];
    bodyOrReq.on("data", (c) => chunks.push(c));
    bodyOrReq.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

function parseAuthBearer(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Mirror your Realm user_login validation behavior (simple + returns field errors)
function validateLoginInput(data) {
  const errors = {};
  const email = (data.email || "").trim();
  const password = (data.password || "").trim();

  if (!email) {
    errors.email = "Email Field is Required";
  } else {
    // simple email check
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.toLowerCase());
    if (!ok) errors.email = "Email is invalid";
  }

  if (!password) {
    errors.password = "Password Field is Required";
  }

  return { errors, isValid: Object.keys(errors).length === 0 };
}

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();

  // Let vercel.json attach CORS headers; just handle preflight quickly.
  if (method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  // Get env secret (Realm used context.values.get('secretKey'))
  const secretKey = process.env.secretKey || process.env.JWT_SECRET || "";
  if (!secretKey) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "Missing secretKey env value" }));
  }

  try {
    const db = await getDb();
    const users = db.collection("users");

    if (method === "GET") {
      // Validate current session from Authorization: Bearer <token>
      try {
        const token = parseAuthBearer(req);
        if (!token) throw new Error("no token");

        // Verify signature; accept exp/iat as provided
        const decoded = jwt.verify(token, secretKey);

        // Realm logic: ensure the exact token exists in user's tokens array
        const user = await users.findOne({
          _id: new ObjectId(String(decoded._id)),
          "tokens.token": token
        }, { projection: { _id: 1, name: 1, email: 1, admin: 1 } });

        if (!user) throw new Error("token not found");

        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          admin: !!user.admin
        }));
      } catch {
        // Mirror Realm’s error shape/wording
        res.statusCode = 401;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ error: "401", message: "Invalid credientials, Please Sign In" }));
      }
    }

    if (method === "POST") {
      // Sign in: validate body → verify password → issue JWT → push token into tokens[]
      const body = await readJSON(req);
      const { errors, isValid } = validateLoginInput(body);
      if (!isValid) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify(errors));
      }

      const email = String(body.email || "").toLowerCase();
      const password = String(body.password || "");

      // find user by email
      let user = await users.findOne({ email });
      if (!user) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ error: "404", message: "Email and/or Password Incorrect" }));
      }

      // verify password (password-hash compatible)
      const ok = passwordHash.verify(password, user.password || "");
      if (!ok) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ error: "404", message: "Email and/or Password Incorrect" }));
      }

      // create JWT, 365 days like Realm (they placed a Date in exp; we use standard exp)
      const token = jwt.sign(
        { _id: user._id.toString() },
        secretKey,
        { algorithm: "HS256", expiresIn: "365d" }
      );

      // push token into tokens array (each entry has its own _id + token), like Realm
      const tokenDoc = { _id: new ObjectId(), token };
      const tokens = Array.isArray(user.tokens) ? user.tokens.concat(tokenDoc) : [tokenDoc];

      await users.updateOne(
        { _id: new ObjectId(user._id) },
        { $set: { tokens } }
      );

      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ token, id: user._id.toString() }));
    }

    if (method === "DELETE") {
      // Sign out: remove this bearer token from tokens[]
      const token = parseAuthBearer(req);
      if (!token) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ ok: false, error: "Missing Authorization Bearer token" }));
      }

      let decoded = null;
      try { decoded = jwt.verify(token, secretKey); }
      catch {
        // still attempt to pull token by value, even if decode fails (parity with Realm token store)
      }

      const q = decoded ? { _id: new ObjectId(String(decoded._id)) } : { "tokens.token": token };
      const r = await users.updateOne(q, { $pull: { tokens: { token } } });

      const ok = r.modifiedCount > 0 || r.matchedCount > 0;
      res.statusCode = ok ? 200 : 404;
      res.setHeader("content-type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok }));
    }

    // Method not allowed
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST, DELETE, OPTIONS");
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: e.message || "Internal error" }));
  }
};
