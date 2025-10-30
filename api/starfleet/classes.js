// api/starfleet/classes.js
const { makeHandler } = require("../../src/api_utils");

module.exports = makeHandler({
  function_name: "Starfleet_classes",
  methods: ["GET"],
  return_type: "JSON"
});
