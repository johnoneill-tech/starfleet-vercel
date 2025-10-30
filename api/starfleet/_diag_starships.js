const { getDb } = require("../../src/db");

module.exports = async (req, res) => {
  try {
    const db = await getDb();
    const c = db.collection("starships");

    const count = await c.countDocuments({});
    const sample = await c.find({}, { projection: { _id: 0, name: 1, class: 1 } })
                          .limit(5)
                          .toArray();

    res.setHeader("content-type", "application/json; charset=utf-8");
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, count, sample }));
  } catch (e) {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
};
