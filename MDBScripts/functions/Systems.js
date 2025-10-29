exports = async function (payload, response) {
  const systems = context.services
    .get("mongodb-atlas")
    .db("StarfleetDatabase")
    .collection("systems");
  const id = payload.query.id;
  let responseData = { message: "Something Went Wrong in the 'systems' Function" };

  switch (context.request.httpMethod) {
    // Get a list of systems (search by name) or by _id for individual
    case "GET": {
      if (!id) {
        const { systemsPerPage = 10, page = 0 } = payload.query;
        let query = {};

        if (payload.query.name) {
          query = { name: { $regex: "^" + payload.query.name + ".*", $options: "i" } };
        }

        const pipeline = [
          { $match: query },
          {
            $lookup: {
              from: "photos",
              let: { id: "$_id" },
              pipeline: [
                { $match: { $and: [{ $expr: { $eq: ["$owner", "$$id"] } }, { primary: true }] } },
                { $project: { _id: 0, title: 0, description: 0, owner: 0 } },
              ],
              as: "pics",
            },
          },
          { $sort: { name: 1 } },
          { $addFields: { picUrl: "$pics.url" } },
          { $project: { pics: 0 } },
          { $skip: page * systemsPerPage },
          { $limit: systemsPerPage },
        ];

        let resultsList = await systems.aggregate(pipeline).toArray();

        resultsList.forEach((result) => {
          result._id = result._id.toString();
          if (result.numOfPlanets) result.numOfPlanets = result.numOfPlanets.toString();
        });

        responseData = {
          systems: resultsList,
          page: page.toString(),
          entries_per_page: systemsPerPage.toString(),
          total_results: await systems.count(query).then((num) => num.toString()),
        };
      } else {
        const pipeline = [
          { $match: { _id: BSON.ObjectId(id) } },
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                {
                  $match: {
                    $and: [
                      { $expr: { $eq: ["$systemId", "$$id"] } },
                      { $or: [{ type: "Assignment" }, { type: "Promotion" }, { type: "Demotion" }] },
                      { position: { $ne: "Retired" } },
                    ],
                  },
                },
                { $sort: { date: -1 } },
                { $limit: 1 },
                {
                  $project: {
                    rankLabel: 1,
                    position: 1,
                    provisional: 1,
                    location: 1,
                    date: 1,
                    endDate: 1,
                    starshipId: 1,
                    _id: 0,
                  },
                },
                {
                  $lookup: {
                    from: "starships",
                    let: { id: "$starshipId" },
                    pipeline: [
                      { $match: { $expr: { $eq: ["$_id", "$$id"] } } },
                      { $project: { _id: 0, name: 1, registry: 1 } },
                    ],
                    as: "starshipInfo",
                  },
                },
                {
                  $replaceRoot: {
                    newRoot: { $mergeObjects: [{ $arrayElemAt: ["$starshipInfo", 0] }, "$$ROOT"] },
                  },
                },
                { $project: { starshipInfo: 0 } },
              ],
              as: "lastAssignment",
            },
          },
          {
            $replaceRoot: {
              newRoot: { $mergeObjects: [{ $arrayElemAt: ["$lastAssignment", 0] }, "$$ROOT"] },
            },
          },
          { $project: { lastAssignment: 0 } },

          // Count number of starships assigned
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                {
                  $match: {
                    $and: [
                      { $expr: { $eq: ["$systemId", "$$id"] } },
                      { type: "Assignment" },
                      { starshipId: { $exists: true } },
                    ],
                  },
                },
                { $group: { _id: "$starshipId" } },
                { $count: "vesslesNum" },
              ],
              as: "starshipAssignments",
            },
          },
          { $addFields: { starshipCount: "$starshipAssignments.vesslesNum" } },
          { $project: { starshipAssignments: 0 } },

          // Count number of Assignments, Promotions and Demotions
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                {
                  $match: {
                    $and: [
                      { $expr: { $eq: ["$systemId", "$$id"] } },
                      {
                        $or: [{ type: "Assignment" }, { type: "Promotion" }, { type: "Demotion" }],
                      },
                    ],
                  },
                },
                { $count: "AssignProDeNum" },
              ],
              as: "Assign-Pro-De",
            },
          },
          { $addFields: { assignCount: "$Assign-Pro-De.AssignProDeNum" } },
          { $project: { "Assign-Pro-De": 0 } },

          // Count number of general missions
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                {
                  $match: {
                    $and: [{ $expr: { $eq: ["$systemId", "$$id"] } }, { type: "Mission" }],
                  },
                },
                { $count: "generalNum" },
              ],
              as: "generalMissions",
            },
          },
          { $addFields: { missionCount: "$generalMissions.generalNum" } },
          { $project: { generalMissions: 0 } },

          // Count number of Life Events
          {
            $lookup: {
              from: "events",
              let: { id: "$_id" },
              pipeline: [
                {
                  $match: {
                    $and: [{ $expr: { $eq: ["$systemId", "$$id"] } }, { type: "Life Event" }],
                  },
                },
                { $count: "lifeEventsNum" },
              ],
              as: "lifeEvents",
            },
          },
          { $addFields: { lifeEventCount: "$lifeEvents.lifeEventsNum" } },
          { $project: { lifeEvents: 0 } },
        ];

        responseData = await systems.aggregate(pipeline).next();

        responseData._id = responseData._id.toString();
        if (responseData.starshipId) {
          responseData.starshipId = responseData.starshipId.toString();
        }
        if (responseData.species_id) {
          responseData.species_id = responseData.species_id.toString();
        }
        if (responseData.birthDate) {
          responseData.birthDate = new Date(responseData.birthDate).toISOString();
        }
        if (responseData.deathDate) {
          responseData.deathDate = new Date(responseData.deathDate).toISOString();
        }
        if (responseData.date) {
          responseData.date = new Date(responseData.date).toISOString();
        }
        if (responseData.endDate) {
          responseData.endDate = new Date(responseData.endDate).toISOString();
        }

        if (responseData.starshipCount) {
          responseData.starshipCount = responseData.starshipCount.toString();
        }
        if (responseData.assignCount) {
          responseData.assignCount = responseData.assignCount.toString();
        }
        if (responseData.missionCount) {
          responseData.missionCount = responseData.missionCount.toString();
        }
        if (responseData.lifeEventCount) {
          responseData.lifeEventCount = responseData.lifeEventCount.toString();
        }
      }
      return responseData;
    }
    case "POST": {
      const newSystem = EJSON.parse(payload.body.text());
      if (newSystem.numOfPlanets) newSystem.numOfPlanets = parseInt(newSystem.numOfPlanets);
      if (newSystem.starTypes) {
        const newStarTypes = newSystem.starTypes.map(a => a.value);
        newSystem.starTypes = newStarTypes;
      }

      try {
        await systems.insertOne(newSystem);
        return { message: "System Inserted Successfully" };
      } catch (err) {
        console.error(`System Insert Failed ${err.message}`);
        return { message: `System Insert Failed ${err.message}` };
      }
      break;
    }
    case "DELETE": {
      try {
        await systems.deleteOne({ _id: BSON.ObjectId(id) });
        return { message: "Personnel Record Successfully Deleted" };
      } catch (err) {
        return { message: `Deletion of Record Failed ${err.message}` };
      }
      break;
    }

    case "PUT": {
      const updatedInfo = EJSON.parse(payload.body.text());
      const systemId = updatedInfo._id;
      const systemName = updatedInfo.name;
      if (updatedInfo.numOfPlanets) updatedInfo.numOfPlanets = parseInt(updatedInfo.numOfPlanets);

      delete updatedInfo["_id"];

      try {
        await systems.updateOne({ _id: BSON.ObjectId(systemId) }, { $set: updatedInfo });
        return { message: "Record of " + systemName + " Updated Successfully" };
      } catch (err) {
        console.error(`Record Update Failed ${err.message}`);
        return { message: `Record Update Failed ${err.message}` };
      }
    }
  }
};
