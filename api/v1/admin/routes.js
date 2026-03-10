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
  offlineBookAppointmentController,
} = require("./controllers");
const { rejectAppointmentValidator, offlineBookValidator } = require("./dto");

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

adminsRouter.get(
  "/appointments/pending",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  getPendingNormalAppointmentsController,
);

adminsRouter.get(
  "/appointments/emergency",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  getEmergencyAppointmentsController,
);

adminsRouter.post(
  "/appointments/:appointmentId/approve",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  approveAppointmentController,
);

adminsRouter.post(
  "/appointments/:appointmentId/reject",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  rejectAppointmentValidator,
  rejectAppointmentController,
);

adminsRouter.put(
  "/doctors/:doctorId/availability",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  setDoctorAvailabilityController,
);

adminsRouter.post(
  "/appointments/offline-book",
  validateLoggedInUserMiddleware,
  validateIsAdminMiddleware,
  offlineBookValidator,
  offlineBookAppointmentController,
);

module.exports = { adminsRouter };
