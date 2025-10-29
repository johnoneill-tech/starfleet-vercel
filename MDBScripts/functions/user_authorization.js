exports = async function(data){
  const jwt = require("jsonwebtoken");

  try {
    // 1. check for JWT
    const jwtToken = data.token;
    if (!jwtToken) {
      return "Not Authorized 1";
    }

    const payload = jwt.verify(jwtToken, "NcZaYwGzEvRxX5nG");
    let user = payload.user;

    return user;
  } catch (err) {
    console.error(err.message);
    return "Not Authorized 2";
  }


};
