exports = function(data){
  const Validator = require("validator");
  const isEmpty = require("is-empty");

  let errors = {};

  // Convert empty fields to an empty string so we can use validator functions
  data.email = !isEmpty(data.email) ? data.email : "";
  data.password = !isEmpty(data.password) ? data.password : "";

  // Email Check
  if (Validator.isEmpty(data.email)) {
    errors.email = "Email Field is Required";
  } else if (!Validator.isEmail(data.email)) {
    errors.email = "Email is invalid";
  }

  // Password Checks
  if (Validator.isEmpty(data.password)) {
    errors.password = "Password Field is Required";
  }

  return {
    errors,
    isValid: isEmpty(errors),
  };
};
