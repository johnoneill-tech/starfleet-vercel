exports = async function (payload, response) {
  const category = payload.query.category === "personnel" ? "officers" :payload.query.category ;
  const collectionToCount = context.services
    .get("mongodb-atlas")
    .db("StarfleetDatabase")
    .collection(category);
  let responseData = { message: "Something Went Wrong in the 'starship' Function" };
  
  responseData = {
    count: await collectionToCount.count().then((num) => num.toString()),
  };
  
  return responseData;
}
