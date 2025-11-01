// api/starfleet/login.js
// Vercel-port of Realm "login" function (GET/POST only), matching original behavior and messages.

const { getDb } = require("../../src/db");
const { ObjectId } = require("bson");
const jwt = require("jsonwebtoken");           // npm i jsonwebtoken
const passwordHash = require("password-hash"); // npm i password-hash

// ---- helpers ----
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function writeJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

// Match Realm messages (including original typo “credientials”)
const MSG_INVALID = { error: "401", message: "Invalid credientials, Please Sign In" };
const MSG_BADLOGIN = { error: "404", message: "Email and/or Password Incorrect" };

module.exports = async (req, res) => {
  const method = (req.method || "GET").toUpperCase();

  // OPTIONS preflight if needed
  if (method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const SECRET_KEY = process.env.SECRET_KEY;
  if (!SECRET_KEY) {
    return writeJSON(res, 500, { error: "500", message: "Missing SECRET_KEY" });
  }

  try {
    const db = await getDb();
    const users = db.collection("users");

    // ---------------- GET ----------------
    if (method === "GET") {
      try {
        const auth = req.headers.authorization || req.headers.Authorization || "";
        if (!auth.startsWith("Bearer ")) {
          return writeJSON(res, 200, MSG_INVALID); // original function returns JSON body (not HTTP 401)
        }

        const jwToken = auth.replace("Bearer ", "").trim();

        // Decode WITHOUT verifying exp the Realm-way? The original used utils.jwt.decode(..., false)
        // We'll decode AND verify signature, but allow for exp check as jwt.verify does by default.
        let decoded;
        try {
          decoded = jwt.verify(jwToken, SECRET_KEY, { algorithms: ["HS256"] });
        } catch (e) {
          // If verification fails, mirror old contract:
          return writeJSON(res, 200, MSG_INVALID);
        }

        const user = await users.findOne({
          _id: new ObjectId(String(decoded._id)),
          "tokens.token": jwToken,
        });

        if (!user) {
          return writeJSON(res, 200, MSG_INVALID);
        }

        return writeJSON(res, 200, {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          admin: !!user.admin,
        });
      } catch {
        // Mirror original catch
        return writeJSON(res, 200, MSG_INVALID);
      }
    }

    // ---------------- POST ----------------
    if (method === "POST") {
      const body = await readJsonBody(req);
      // Realm called a separate validation function; we’ll enforce minimal checks inline
      const email = (body.email || "").toString().trim().toLowerCase();
      const password = (body.password || "").toString();

      if (!email || !password) {
        return writeJSON(res, 200, MSG_BADLOGIN);
      }

      let userCheck;
      try {
        userCheck = await users.findOne({ email });
        if (!userCheck) {
          return writeJSON(res, 200, MSG_BADLOGIN);
        }
      } catch (e) {
        return writeJSON(res, 200, { message: String(e) });
      }

      // Verify password using password-hash (same as Realm)
      const isMatch = (() => {
        try {
          // Typical stored string format works with passwordHash.verify
          return passwordHash.verify(password, userCheck.password);
        } catch {
          return false;
        }
      })();

      if (!isMatch) {
        return writeJSON(res, 200, MSG_BADLOGIN);
      }

      // Build 1-year token (matches your Realm logic with exp set a year ahead)
      const now = new Date();
      const exp = new Date(now);
      exp.setDate(exp.getDate() + 365);

      const tokenPayload = {
        _id: userCheck._id.toString(),
        iat: Math.floor(now.getTime() / 1000),
        exp: Math.floor(exp.getTime() / 1000),
      };

      // Sign with HS256 using SECRET_KEY (Realm used utils.jwt.encode("HS256", ...))
      const token = jwt.sign(tokenPayload, SECRET_KEY, { algorithm: "HS256" });

      // Append token into users.tokens array
      const tokens = Array.isArray(userCheck.tokens) ? userCheck.tokens.slice() : [];
      tokens.push({ _id: new ObjectId(), token });

      await users.updateOne(
        { _id: new ObjectId(userCheck._id) },
        { $set: { tokens } }
      );

      return writeJSON(res, 200, { token, id: userCheck._id.toString() });
    }

    // Fallback
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return writeJSON(res, 405, { error: "405", message: "Method Not Allowed" });
  } catch (e) {
    return writeJSON(res, 500, { error: "500", message: e.message || "Internal error" });
  }
};
