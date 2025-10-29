// src/realm_shim.js
function makeRealmContext(db, values = {}) {
  return {
    services: { get: (name) => (name === "mongodb-atlas" ? { db: () => db } : (()=>{throw new Error(`Unsupported service: ${name}`)})()) },
    values:   { get: (k) => values[k] ?? process.env[k] },
    http:     {
      get:  (url, opts) => fetch(url, { method: "GET",  ...(opts||{}) }),
      post: (url, opts) => fetch(url, { method: "POST", ...(opts||{}) }),
    },
    user: { id: null, data: null }
  };
}
module.exports = { makeRealmContext };
