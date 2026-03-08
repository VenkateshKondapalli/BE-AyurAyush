const express = require("express");
const {
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
} = require("../middlewares");
const {
  adminDashboardController,
  reviewDoctorApplicationsController,
  approveDoctorApplicationController,
  rejectDoctorApplicationController,
  getpendingDoctorApplicationsController,
  getEmergencyAppointmentsController,
  approveAppointmentController,
  rejectAppointmentController,
  setDoctorAvailabilityController,
} = require("./controllers");

const adminsRouter = express.Router();

adminsRouter.get(
  "/dashboard",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  adminDashboardController,
);

adminsRouter.get(
  "/doctor-applications",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  reviewDoctorApplicationsController,
);

adminsRouter.post(
  "/doctor-applications/:applicationId/approve",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  approveDoctorApplicationController,
);

adminsRouter.post(
  "/doctor-applications/:applicationId/reject",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  rejectDoctorApplicationController,
);

// Get pending normal appointments
adminsRouter.get(
  "/appointments/pending",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  getpendingDoctorApplicationsController,
);

// Get emergency appointments
adminsRouter.get(
  "/appointments/emergency",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  getEmergencyAppointmentsController,
);

// Approve appointment (with optional edits)
adminsRouter.post(
  "/appointments/:appointmentId/approve",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  approveAppointmentController,
);

// Reject appointment
adminsRouter.post(
  "/appointments/:appointmentId/reject",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  rejectAppointmentController,
);

// Set doctor availability
adminsRouter.put(
  "/doctors/:doctorId/availability",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  setDoctorAvailabilityController,
);

module.exports = {
  adminsRouter,
};
