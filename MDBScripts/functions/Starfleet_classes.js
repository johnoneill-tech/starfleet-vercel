// This function is the webhook's request handler.
exports = async function(payload, response) {
    const searchQuery = payload.query.search || "";
    let classes = [];
    
    const collection = context.services.get("mongodb-atlas").db("StarfleetDatabase").collection("starships");

    try {
      if (searchQuery && searchQuery !== undefined && searchQuery !== "") {
        classes = await collection.distinct("class",{ class: { $regex: "^" + searchQuery + ".*", $options: "i" }});
      } else {
        classes = await collection.distinct("class");
      }
      return classes;
    } catch (e) {
      console.error(`Unable to get classes, ${e}`);
      return classes;
    }
    
    // return searchQuery;
};
