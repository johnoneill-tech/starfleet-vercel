const start = Date.now();
try {
  const routes = require("../src/routes");
  console.log("Imported routes in", Date.now() - start, "ms");
  module.exports = (req, res) => {
    res.status(200).json({
      ok: true,
      message: "Imported successfully",
      time: Date.now() - start,
      type: typeof routes.buildRouter,
    });
  };
} catch (e) {
  module.exports = (req, res) => {
    res.status(500).json({ ok: false, error: e.message, stack: e.stack });
  };
}
