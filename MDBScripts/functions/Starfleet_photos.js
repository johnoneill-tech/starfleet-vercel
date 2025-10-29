exports = async function(payload, response) {
  
  const subjectId = payload.query.subject_id || "";
  const photoId = payload.query.id;
  const photos = context.services.get("mongodb-atlas").db("StarfleetDatabase").collection("photos");
      
  switch(context.request.httpMethod) {
    case "GET": {
      if(!photoId) {
        let subjectPhotos = [];
        
        subjectPhotos = await photos.find({owner: BSON.ObjectId(subjectId)}).sort({ year: -1 }).toArray();
        
        subjectPhotos.forEach(photo => {
          photo._id = photo._id.toString();
          photo.owner = photo.owner.toString();
        });
    
        return subjectPhotos;
      } else {
        let photoInfo;
        photoInfo = await photos.findOne({_id: BSON.ObjectId(photoId)});
        
        // return photoInfo;
        
        photoInfo._id = photoInfo._id.toString();
        photoInfo.owner = photoInfo.owner.toString();
        
        return photoInfo;        
      }
      break;
    }
    case "POST": {
      const newPhotoInfo = EJSON.parse(payload.body.text());
      newPhotoInfo.owner = BSON.ObjectId(newPhotoInfo.owner.toString());
      delete newPhotoInfo["_id"];
      try {
        await photos.insertOne(newPhotoInfo);
        return { message: "Photo Inserted Successfully" };
      } catch (err) {
        console.error(`Photo Insert Failed ${err.message}`);
        return {message: `Photo Insert Failed ${err.message}`};
      }
      break;
    }
    case "PUT": {
      const updatedInfo = EJSON.parse(payload.body.text());
      const photoId = updatedInfo._id;

      delete updatedInfo["_id"];
      delete updatedInfo["owner"];
      delete updatedInfo["url"];

      try {
        await photos.updateOne({ _id: BSON.ObjectId(photoId) }, { $set: updatedInfo });
        return { message: "Photo Updated Successfully" };
      } catch (err) {
        console.error(`Photo Update Failed ${err.message}`);
        return { message: `Photo Update Failed ${err.message}` };
      }
      break;
    }
    case "DELETE": {
      try {
        // let photoURL = await photos.findOne({ _id: BSON.ObjectId(photoId) }, {"url": 1, "_id": 0});
        await photos.deleteOne({ _id: BSON.ObjectId(photoId) });
        return { message: "Photo Info Successfully Deleted" };
      } catch (err) {
        return { message: `Deletion of Photo Info Failed ${err.message}` };
      }
      break;
    }
  }
};
