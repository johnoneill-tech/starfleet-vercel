exports = async function (payload, response) {
  const starships = context.services
    .get("mongodb-atlas")
    .db("StarfleetDatabase")
    .collection("starships");
  const id = payload.query.id;
  let responseData = { message: "Something Went Wrong in the 'starship' Function" };

  switch (context.request.httpMethod) {
    // Get a list of starships (search by name or class if search value provided) or by _id for individual
    case "GET": {
      if (!id) {
        let { starshipsPerPage = 12, page = 0 } = payload.query;
        starshipsPerPage = parseInt(starshipsPerPage);
        let nameQuery = {};
        let classQuery = {};
        let startTimeFrame = 0;
        let endTimeFrame = 999999;

        if (payload.query.name) {
          nameQuery = { name: { $regex: "^" + payload.query.name + ".*", $options: "i" } };
        }

        if (!payload.query.class || payload.query.class === "All") {
          classQuery = { $or: [{ class: { $exists: true } }, { class: { $exists: false } }] };
        } else if (payload.query.class === "Unknown") {
          classQuery = { class: { $exists: false } };
        } else {
          classQuery = { class: { $eq: payload.query.class } };
        }
        
        if (payload.query.timeframe === "22nd") {
          endTimeFrame = 400;
        } else if (payload.query.timeframe === "23rd") {
          startTimeFrame = 400; 
          endTimeFrame = 2500;
        } else if (payload.query.timeframe === "24th") {
          startTimeFrame = 2500; 
          endTimeFrame = 110000;
        } else if (payload.query.timeframe === "32nd") {
          startTimeFrame = 110000;
        }

        timeQuery = { $and: [ { ship_id: { $gte: startTimeFrame } }, { ship_id: { $lt: endTimeFrame } } ] };

        let query = { $and: [ nameQuery, classQuery, timeQuery ] };
        
        const pipeline = [
          { $match: query },
          {
            $lookup: {
              from: "photos",
              let: { id: "$_id" },
              pipeline: [
                { $match: { $and: [ { $expr: { $eq: ["$owner", "$$id"] } }, { primary: true } ] } },
                { $project: { _id: 0, title: 0, description: 0, owner: 0 } },
                { $sort: { year: -1 } },
                { $limit: 1 },
              ],
              as: "starshipPics",
            },
          },
          { $addFields: { picUrl: "$starshipPics.url" } },
          { $project: { starshipPics: 0 } },
          { $sort: { ship_id: 1 } },
          { $skip: page * starshipsPerPage },
          { $limit: starshipsPerPage },
        ];

        let starshipsList = await starships.aggregate(pipeline).toArray();

        starshipsList.forEach((starship) => {
          starship._id = starship._id.toString();
          starship.ship_id = starship.ship_id.toString();
          if (starship.launch_date) {
            starship.launch_date = new Date(starship.launch_date).toISOString();
          }
          if (starship.commission_date) {
            starship.commission_date = new Date(starship.commission_date).toISOString();
          }
          if (starship.decommission_date) {
            starship.decommission_date = new Date(starship.decommission_date).toISOString();
          }
          if (starship.destruction_date) {
            starship.destruction_date = new Date(starship.destruction_date).toISOString();
          }
        });

        responseData = {
          starships: starshipsList,
          page: page.toString(),
          entries_per_page: starshipsPerPage.toString(),
          total_results: await starships.count(query).then((num) => num.toString()),
          search_queries: query,
        };
      } else {
        const pipeline = [
          { $match: { _id: BSON.ObjectId(id) } },

          // Count number of personnel assigned
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                {
                  $match: {
                    $and: [{ $expr: { $eq: ["$starshipId", "$$id"] } }, { type: "Assignment" }],
                  },
                },
                { $group: { _id: "$officerId" } },
                { $count: "personnelNum" },
              ],
              as: "personnelAssignments",
            },
          },
          { $addFields: { personnelCount: "$personnelAssignments.personnelNum" } },
          { $project: { personnelAssignments: 0 } },

          // Count number of general missions
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                {
                  $match: {
                    $and: [{ $expr: { $eq: ["$starshipId", "$$id"] } }, { type: "Mission" }, {officerId: {$exists: false}}],
                  },
                },
                { $count: "missonNum" },
              ],
              as: "missions",
            },
          },
          { $addFields: { missionCount: "$missions.missonNum" } },
          { $project: { missions: 0 } },

          // Count number of First Contact missions
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                {
                  $match: {
                    $and: [{ $expr: { $eq: ["$starshipId", "$$id"] } }, { type: "First Contact" }],
                  },
                },
                { $count: "firstContactNum" },
              ],
              as: "firstContact",
            },
          },
          { $addFields: { firstContactCount: "$firstContact.firstContactNum" } },
          { $project: { firstContact: 0 } },

          // Count number of Maintenance/Repair/Upgrades
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                {
                  $match: {
                    $and: [{ $expr: { $eq: ["$starshipId", "$$id"] } }, { type: "Maintenance" }],
                  },
                },
                { $count: "maintenanceNum" },
              ],
              as: "maintenance",
            },
          },
          { $addFields: { maintenanceCount: "$maintenance.maintenanceNum" } },
          { $project: { maintenance: 0 } },
        ];

        responseData = await starships.aggregate(pipeline).next();

        responseData._id = responseData._id.toString();
        responseData.ship_id = responseData.ship_id.toString();
        if (responseData.launch_date) {
          responseData.launch_date = new Date(responseData.launch_date).toISOString();
        }
        if (responseData.commission_date) {
          responseData.commission_date = new Date(responseData.commission_date).toISOString();
        }
        if (responseData.decommission_date) {
          responseData.decommission_date = new Date(responseData.decommission_date).toISOString();
        }
        if (responseData.destruction_date) {
          responseData.destruction_date = new Date(responseData.destruction_date).toISOString();
        }

        if (responseData.personnelCount) {
          responseData.personnelCount = responseData.personnelCount.toString();
        }
        if (responseData.missionCount) {
          responseData.missionCount = responseData.missionCount.toString();
        }
        if (responseData.firstContactCount) {
          responseData.firstContactCount = responseData.firstContactCount.toString();
        }
        if (responseData.maintenanceCount) {
          responseData.maintenanceCount = responseData.maintenanceCount.toString();
        }

        // responseData.events.forEach(event => {
        //   if(event.date) {event.date = new Date(event.date).toISOString();}
        //   event._id = event._id.toString();
        //   if(event.officerId) {event.officerId = event.officerId.toString();}
        //   if(event.starshipId) {event.starshipId = event.starshipId.toString();}
        // });
      }
      return responseData;
    }
    case "POST": {
      const newStarship = EJSON.parse(payload.body.text());
      if (newStarship.ship_id) {
        newStarship.ship_id = parseInt(newStarship.ship_id);
      }
      if (newStarship.launch_date) {
        newStarship.launch_date = new Date(newStarship.launch_date);
      }
      if (newStarship.commission_date) {
        newStarship.commission_date = new Date(newStarship.commission_date);
      }
      if (newStarship.decommission_date) {
        newStarship.decommission_date = new Date(newStarship.decommission_date);
      }
      if (newStarship.destruction_date) {
        newStarship.destruction_date = new Date(newStarship.destruction_date);
      }

      try {
        await starships.insertOne(newStarship);
        return { message: "Record Inserted Successfully" };
      } catch (err) {
        console.error(`Record Insert Failed ${err.message}`);
        return { message: `Record Insert Failed ${err.message}` };
      }
      break;
    }
    case "PUT": {
      const updatedStarship = EJSON.parse(payload.body.text());
      const starshipId = updatedStarship._id;
      let starshipName = updatedStarship.name;
      if (updatedStarship.registry) starshipName += " " + updatedStarship.registry;

      if (updatedStarship.ship_id) {
        updatedStarship.ship_id = parseInt(updatedStarship.ship_id);
      }
      if (updatedStarship.launch_date) {
        updatedStarship.launch_date = new Date(updatedStarship.launch_date);
      }
      if (updatedStarship.commission_date) {
        updatedStarship.commission_date = new Date(updatedStarship.commission_date);
      }
      if (updatedStarship.decommission_date) {
        updatedStarship.decommission_date = new Date(updatedStarship.decommission_date);
      }
      if (updatedStarship.destruction_date) {
        updatedStarship.destruction_date = new Date(updatedStarship.destruction_date);
      }

      delete updatedStarship["_id"];

      try {
        await starships.updateOne({ _id: BSON.ObjectId(starshipId) }, { $set: updatedStarship });
        return { message: "Record " + starshipName + " Updated Successfully" };
        // return updatedInfo;
      } catch (err) {
        console.error(`Record Update Failed ${err.message}`);
        return { message: `Record Update Failed ${err.message}` };
      }
      break;
    }
    case "DELETE": {
      try {
        await events.deleteOne({ _id: BSON.ObjectId(id) });
        return { message: "Starship Record Successfully Deleted" };
      } catch (err) {
        return { message: `Deletion of Record Failed ${err.message}` };
      }
      break;
    }
  }
};
