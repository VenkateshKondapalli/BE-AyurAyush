const express = require("express");
const {
  validateLoggedInUserMiddleware,
  validateDoctorRole,
} = require("../middlewares");
const {
  doctorDashboardController,
  getDoctorAppointmentsController,
  getTodayAppointmentsController,
  getAppointmentDetailController,
  completeAppointmentController,
} = require("./controllers");

const doctorsRouter = express.Router();

// Dashboard
doctorsRouter.get(
  "/dashboard",
  validateLoggedInUserMiddleware,
  validateDoctorRole,
  doctorDashboardController,
);

// Get all doctor appointments
doctorsRouter.get(
  "/appointments",
  validateLoggedInUserMiddleware,
  validateDoctorRole,
  getDoctorAppointmentsController,
);

// Get today's appointments
doctorsRouter.get(
  "/appointments/today",
  validateLoggedInUserMiddleware,
  validateDoctorRole,
  getTodayAppointmentsController,
);

// Get specific appointment details
doctorsRouter.get(
  "/appointments/:appointmentId",
  validateLoggedInUserMiddleware,
  validateDoctorRole,
  getAppointmentDetailController,
);

// Complete appointment
doctorsRouter.post(
  "/appointments/:appointmentId/complete",
  validateLoggedInUserMiddleware,
  validateDoctorRole,
  completeAppointmentController,
);
module.exports = {
  doctorsRouter,
};
