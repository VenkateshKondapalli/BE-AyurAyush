const express = require("express");
const {
  validateLoggedInUserMiddleware,
  validatePatientRole,
} = require("../middlewares");
const {
  patientDashboardController,
  applyForDoctorRoleController,
  getAvailableSlotsController,
  bookAppointmentController,
  cancelAppointmentController,
  getAppointmentDetailsController,
  getPatientAppointmentsController,
} = require("./controllers");

const patientsRouter = express.Router();

patientsRouter.get(
  "/dashboard",
  validateLoggedInUserMiddleware,
  validatePatientRole,
  patientDashboardController,
);

// Apply for doctor role
patientsRouter.post(
  "/apply-doctor-role",
  validateLoggedInUserMiddleware,
  validatePatientRole,
  applyForDoctorRoleController,
);

// Get available time slots for a doctor
patientsRouter.get(
  "/appointments/available-slots",
  validateLoggedInUserMiddleware,
  validatePatientRole,
  getAvailableSlotsController,
);

// Book appointment
patientsRouter.post(
  "/appointments/book",
  validateLoggedInUserMiddleware,
  validatePatientRole,
  bookAppointmentController,
);

// Get all patient appointments
patientsRouter.get(
  "/appointments",
  validateLoggedInUserMiddleware,
  validatePatientRole,
  getPatientAppointmentsController,
);

// Get specific appointment details
patientsRouter.get(
  "/appointments/:appointmentId",
  validateLoggedInUserMiddleware,
  validatePatientRole,
  getAppointmentDetailsController,
);

// Cancel appointment
patientsRouter.delete(
  "/appointments/:appointmentId",
  validateLoggedInUserMiddleware,
  validatePatientRole,
  cancelAppointmentController,
);

module.exports = { patientsRouter };
