const { makeHandler } = require("../../src/api_util");
module.exports = makeHandler({ function_name: "Starfleet_ranks", methods: ["GET"], return_type: "JSON" });
