# Starfleet API (Vercel)

This is a zero-cost Vercel scaffold to migrate your old MongoDB Atlas HTTPS Endpoints.
Drop your **Realm function files** into `MDBScripts/functions/` (flat `.js` files, e.g. `Systems.js`).

## Deploy (quick)
1. Push this folder to GitHub.
2. Import the repo in Vercel.
3. In Vercel → Project Settings → **Environment Variables**, set:
   - `MONGODB_URI`
   - `MONGODB_DB`
   - `API_KEY` (recommended)
4. Deploy. Your endpoints will be under `/api`:
   - `GET https://<app>.vercel.app/api/Starfleet/ranks`
   - `POST https://<app>.vercel.app/api/Starfleet/personnel`

> Atlas network access: on free hosts there is no fixed egress IP.
> For development, you may temporarily allow `0.0.0.0/0` **and** use a least-privileged DB user.

## Local dev
```bash
npm i
cp .env.example .env  # fill values
vercel dev            # or: node api/index.js (will work, but vercel dev mimics prod path)
```

## Notes
- Endpoints are wired from `src/routes.js` (copied from your `http_endpoints/config.js`).
- Functions are loaded with a small VM and executed with a **Realm-like context shim**.
- If a function expects `context` as the first parameter, adjust `invokeRealmFunction` ordering accordingly.
