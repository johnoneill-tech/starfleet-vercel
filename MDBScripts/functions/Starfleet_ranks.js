// This function is the webhook's request handler.
exports = async function(payload, response) {
    let rankLabels = [];
    
    const ranks = context.services.get("mongodb-atlas").db("StarfleetDatabase").collection("rank");
    
    rankLabels = await ranks.find().sort( {rank_id: 1} ).toArray();
    rankLabels.forEach(rank => {
      // rank._id = rank._id.toString();
      rank.rank_id = rank.rank_id.toString();
      delete rank["_id"];
      // delete rank["rank_id"];
    });
    return rankLabels;
};
