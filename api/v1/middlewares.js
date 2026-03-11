const jwt = require("jsonwebtoken");
const { ROLE_OPTIONS } = require("../../models/userSchema");

const validateLoggedInUserMiddleware = (req, res, next) => {
  try {
    const { authorization } = req.cookies;

    if (!authorization) {
      return res.status(401).json({
        isSuccess: false,
        message: "User not logged in!",
      });
    }

    jwt.verify(authorization, process.env.JWT_SECRET, (err, data) => {
      if (err) {
        return res.status(401).json({
          isSuccess: false,
          message: "User not logged in!",
        });
      }
      req.currentUser = data;
      next();
    });
  } catch (err) {
    next(err);
  }
};

const validateIsAdminMiddleware = (req, res, next) => {
  try {
    const { roles } = req.currentUser;

    if (roles && roles.includes(ROLE_OPTIONS.ADMIN)) {
      req.currentAdmin = req.currentUser;
      next();
    } else {
      return res.status(403).json({
        isSuccess: false,
        message: "User is not an admin",
      });
    }
  } catch (err) {
    next(err);
  }
};

const validatePatientRole = (req, res, next) => {
  try {
    const { roles } = req.currentUser;

    if (roles && roles.includes(ROLE_OPTIONS.PATIENT)) {
      req.currentPatient = req.currentUser;
      next();
    } else {
      return res.status(403).json({
        isSuccess: false,
        message: "Patient access only",
      });
    }
  } catch (err) {
    next(err);
  }
};

const validateDoctorRole = (req, res, next) => {
  try {
    const { roles } = req.currentUser;

    if (roles && roles.includes(ROLE_OPTIONS.DOCTOR)) {
      req.currentDoctor = req.currentUser;
      next();
    } else {
      return res.status(403).json({
        isSuccess: false,
        message: "Doctor access only",
      });
    }
  } catch (err) {
    next(err);
  }
};

module.exports = {
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  validatePatientRole,
  validateDoctorRole,
};
