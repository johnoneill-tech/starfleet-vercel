exports = async function (payload, response) {
  const personnel = context.services
    .get("mongodb-atlas")
    .db("StarfleetDatabase")
    .collection("officers");
  const id = payload.query.id;
  let responseData = { message: "Something Went Wrong in the 'personnel' Function" };

  switch (context.request.httpMethod) {
    // Get a list of starships (search by name or class if search value provided) or by _id for individual
    case "GET": {
      if (!id) {
        const { personnelPerPage = 10, page = 0 } = payload.query;
        let query = {};

        if (payload.query.name) {
          query = {
            $or: [
              { surname: { $regex: payload.query.name, $options: "i" } },
              { first: { $regex: payload.query.name, $options: "i" } },
            ],
          };
        }

        const pipeline = [
          { $match: query },
          {
            $lookup: {
              from: "photos",
              let: { id: "$_id" },
              pipeline: [
                { $match: { $and: [{ $expr: { $eq: ["$owner", "$$id"] } }, { primary: true }] } },
                // { $match: { $expr: { $eq: ["$owner", "$$id"] } } },
                { $project: { _id: 0, title: 0, description: 0, owner: 0 } },
                // { $sort: { year: -1 } },
                // { $limit: 1 },
              ],
              as: "officerPics",
            },
          },
          { $sort: { surname: 1, first: 1, middle: 1 } },
          { $addFields: { picUrl: "$officerPics.url" } },
          { $project: { officerPics: 0 } },
          { $skip: page * personnelPerPage },
          { $limit: personnelPerPage },
        ];

        let personnelList = await personnel.aggregate(pipeline).toArray();

        personnelList.forEach((officer) => {
          officer._id = officer._id.toString();
          if (officer.birthDate) {
            officer.birthDate = new Date(officer.birthDate).toISOString();
          }
          if (officer.deathDate) {
            officer.deathDate = new Date(officer.deathDate).toISOString();
          }
        });

        responseData = {
          personnel: personnelList,
          page: page.toString(),
          entries_per_page: personnelPerPage.toString(),
          total_results: await personnel.count(query).then((num) => num.toString()),
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
                      { $expr: { $eq: ["$officerId", "$$id"] } },
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
                      { $expr: { $eq: ["$officerId", "$$id"] } },
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
                      { $expr: { $eq: ["$officerId", "$$id"] } },
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
                    $and: [{ $expr: { $eq: ["$officerId", "$$id"] } }, { type: "Mission" }],
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
                    $and: [{ $expr: { $eq: ["$officerId", "$$id"] } }, { type: "Life Event" }],
                  },
                },
                { $count: "lifeEventsNum" },
              ],
              as: "lifeEvents",
            },
          },
          { $addFields: { lifeEventCount: "$lifeEvents.lifeEventsNum" } },
          { $project: { lifeEvents: 0 } },
          // {
          //   $lookup: {
          //     from: "officers",
          //     let: {id: "$relationships.officerId"},
          //     pipeline : [
          //       { $match: { $expr: { $in: ["$_id", "$$id"] } } },
          //       { $project: { _id: 0, surname: 1, first: 1, middle: 1 } }
          //     ],
          //     as: "relationships"
          //   },
          // },
          // { $addFields: {
          //   "relationships": {
          //     $map: { 
          //       input: "$relationships", 
          //       as: "relationshipsInfo", 
          //       in: { 
          //         $mergeObjects: [
          //           "$$relationshipsInfo", 
          //             { officerId: { $arrayElemAt: [ "$relationships._id", { $indexOfArray: [ "$info._id", "$$relationshipsInfo.officerId" ] } ] } },
          //             { surname: { $arrayElemAt: [ "$relationships.surname", { $indexOfArray: [ "$info._id", "$$relationshipsInfo.officerId" ] } ] } },
          //             { first:   { $arrayElemAt: [ "$relationships.first",   { $indexOfArray: [ "$info._id", "$$relationshipsInfo.officerId" ] } ] } },
          //             { middle:  { $arrayElemAt: [ "$relationships.middle",  { $indexOfArray: [ "$info._id", "$$relationshipsInfo.officerId" ] } ] } }
          // ]}}}}},
        ];

        responseData = await personnel.aggregate(pipeline).next();

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
      const newOfficer = EJSON.parse(payload.body.text());
      if (newOfficer.birthDate) {
        newOfficer.birthDate = new Date(newOfficer.birthDate);
      }
      if (newOfficer.deathDate) {
        newOfficer.deathDate = new Date(newOfficer.deathDate);
      }

      try {
        await personnel.insertOne(newOfficer);
        return { message: "Record Inserted Successfully" };
      } catch (err) {
        console.error(`Record Insert Failed ${err.message}`);
        return { message: `Record Insert Failed ${err.message}` };
      }
      break;
    }
    case "DELETE": {
      try {
        await personnel.deleteOne({ _id: BSON.ObjectId(id) });
        return { message: "Personnel Record Successfully Deleted" };
      } catch (err) {
        return { message: `Deletion of Record Failed ${err.message}` };
      }
      break;
    }

    case "PUT": {
      const updatedInfo = EJSON.parse(payload.body.text());
      const officerId = updatedInfo._id;
      let officerName;
      // if (updatedInfo.first != null) officerName = updatedInfo.first;
      // if (updatedInfo.first != null && updatedInfo.surname != null) officerName += " ";
      if (updatedInfo.surname != null) officerName = updatedInfo.surname;
      if (updatedInfo.birthDate) {
        updatedInfo.birthDate = new Date(updatedInfo.birthDate);
      }
      if (updatedInfo.deathDate) {
        updatedInfo.deathDate = new Date(updatedInfo.deathDate);
      }
      delete updatedInfo["_id"];

      try {
        await personnel.updateOne({ _id: BSON.ObjectId(officerId) }, { $set: updatedInfo });
        return { message: "Record of " + officerName + " Updated Successfully" };
        // return updatedInfo;
      } catch (err) {
        console.error(`Record Update Failed ${err.message}`);
        return { message: `Record Update Failed ${err.message}` };
      }
    }
  }
};
