exports = async function (payload, response) {
  // payload contains {query, headers, body}
  const events = context.services.get("mongodb-atlas").db("StarfleetDatabase").collection("events");
  const id = payload.query.id;
  const eventSort = { date: parseInt(payload.query.sort) } || { date: 1 };

  let responseData = { message: "Something Went Wrong in the 'events' function" };

  switch (context.request.httpMethod) {
    case "GET": {
      if (!id) {
        let idQuery = {};
        let idType = {};

        if (payload.query.officer_id) {
          idQuery = { officerId: BSON.ObjectId(payload.query.officer_id) };
        } else {
          idQuery = { $and: [{ starshipId: BSON.ObjectId(payload.query.starship_id) }, { officerId: { $exists: false } }] };
        }

        if (payload.query.category == "Assign-Pro-De") {
          idType = { $or: [{ type: "Assignment" }, { type: "Promotion" }, { type: "Demotion" }] };
          if (payload.query.starship_id) {
            idQuery = { starshipId: BSON.ObjectId(payload.query.starship_id) };
          }
        } else if (payload.query.category == "Chronology") {
          idType = { type: { $exists: true } };
        } else {
          idType = { type: payload.query.category };
        }

        let query = { $and: [idQuery, idType] };

        let pipeline = [];

        if (payload.query.starship_id) {
          pipeline = [
            { $match: query },
            {
              $lookup: {
                from: "officers",
                let: { id: "$officerId" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$_id", "$$id"] } } },
                  { $project: { _id: 0, surname: 1, first: 1, middle: 1 } },
                ],
                as: "info",
              },
            },
            { $sort: eventSort },
            {
              $replaceRoot: {
                newRoot: { $mergeObjects: [{ $arrayElemAt: ["$info", 0] }, "$$ROOT"] },
              },
            },
            { $project: { info: 0, __v: 0, starshipId: 0 } },
            {
              $lookup: {
                from: "photos",
                let: { id: "$officerId" },
                pipeline: [
                  { $match: { $and: [{ $expr: { $eq: ["$owner", "$$id"] } }, { primary: true }] } },
                  { $project: { _id: 0, url: 1 } },
                ],
                as: "officerPics",
              },
            },
            { $addFields: { officerPicUrl: "$officerPics.url" } },
            { $project: { officerPics: 0 } },
          ];
        } else {
          pipeline = [
            { $match: query },
            {
              $lookup: {
                from: "starships",
                let: { id: "$starshipId" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$_id", "$$id"] } } },
                  { $project: { _id: 0, name: 1, registry: 1, class: 1, ship_id: 1 } },
                ],
                as: "info",
              },
            },
            { $sort: eventSort },
            {
              $replaceRoot: {
                newRoot: { $mergeObjects: [{ $arrayElemAt: ["$info", 0] }, "$$ROOT"] },
              },
            },
            { $project: { info: 0, __v: 0, officerId: 0 } },
            {
              $lookup: {
                from: "photos",
                let: { id: "$starshipId" },
                pipeline: [
                  { $match: { $and: [{ $expr: { $eq: ["$owner", "$$id"] } }, { primary: true }] } },
                  { $project: { _id: 0, url: 1 } },
                ],
                as: "starshipPics",
              },
            },
            { $addFields: { starshipPicUrl: "$starshipPics.url" } },
            { $project: { starshipPics: 0 } },
          ];
        }

        // return pipeline;

        let responseData = await events.aggregate(pipeline).toArray();

        responseData.forEach((event) => {
          event._id = event._id.toString();
          if (event.date) { event.date = new Date(event.date).toISOString(); }
          if (event.endDate) { event.endDate = new Date(event.endDate).toISOString(); }
          if (event.starshipId) { event.starshipId = event.starshipId.toString(); }
          if (event.ship_id) { event.ship_id = event.ship_id.toString(); }
          if (event.officerId) { event.officerId = event.officerId.toString(); }
        });

        return responseData;
      } else {
        responseData = await events.findOne({ _id: BSON.ObjectId(id) });

        responseData._id = responseData._id.toString();
        if (responseData.officerId) { responseData.officerId = responseData.officerId.toString(); }
        if (responseData.starshipId) { responseData.starshipId = responseData.starshipId.toString(); }
        if (responseData.ship_id) { responseData.ship_id = responseData.ship_id.toString(); }
        if (responseData.date) { responseData.date = new Date(responseData.date).toISOString(); }
        if (responseData.endDate) { responseData.endDate = new Date(responseData.endDate).toISOString(); }
        delete responseData["__v"];
      }
      return responseData;
    }
    case "POST": {
      const eventInfo = EJSON.parse(payload.body.text());

      if (eventInfo.starshipId) eventInfo.starshipId = BSON.ObjectId(eventInfo.starshipId);
      if (eventInfo.officerId) eventInfo.officerId = BSON.ObjectId(eventInfo.officerId);
      if (eventInfo.date) eventInfo.date = new Date(eventInfo.date);
      if (eventInfo.endDate) eventInfo.endDate = new Date(eventInfo.endDate);
      try {
        await events.insertOne(eventInfo);
        return { message: "Record Inserted Successfully" };
      } catch (err) {
        console.error(`Record Insert Failed ${err.message}`);
        return { message: `Record Insert Failed ${err.message}` };
      }
      break;
    }
    case "DELETE": {
      try {
        await events.deleteOne({ _id: BSON.ObjectId(id) });
        return { message: "Event Record Successfully Deleted" };
      } catch (err) {
        return { message: `Deletion of Record Failed ${err.message}` };
      }
      break;
    }
    case "PUT": {
      const updatedInfo = EJSON.parse(payload.body.text());
      const eventId = updatedInfo._id;

      if (updatedInfo.date) updatedInfo.date = new Date(updatedInfo.date);
      if (updatedInfo.endDate) updatedInfo.endDate = new Date(updatedInfo.endDate);
      if (updatedInfo.starshipId) updatedInfo.starshipId = BSON.ObjectId(updatedInfo.starshipId);
      if (updatedInfo.officerId) updatedInfo.officerId = BSON.ObjectId(updatedInfo.officerId);

      delete updatedInfo["_id"];

      try {
        await events.updateOne({ _id: BSON.ObjectId(eventId) }, { $set: updatedInfo });
        return { message: "Record Updated Successfully" };
        // return updatedInfo;
      } catch (err) {
        console.error(`Record Update Failed ${err.message}`);
        return { message: `Record Update Failed ${err.message}` };
      }
    }
  }

  return responseData;
};
