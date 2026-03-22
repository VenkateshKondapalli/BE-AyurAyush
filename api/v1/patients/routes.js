const express = require("express");
const {
    validateLoggedInUserMiddleware,
    validatePatientRole,
    validatePatientOrAdminRole,
} = require("../middlewares");
const {
    patientDashboardController,
    applyForDoctorRoleController,
    getAvailableSlotsController,
    bookAppointmentController,
    cancelAppointmentController,
    getAppointmentDetailsController,
    getPatientAppointmentsController,
    getVerifiedDoctorsController,
    getPatientProfileController,
    updatePatientProfileController,
} = require("./controllers");
const {
    bookAppointmentValidator,
    getAvailableSlotsValidator,
    applyDoctorRoleValidator,
} = require("./dto");

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
    applyDoctorRoleValidator,
    applyForDoctorRoleController,
);

// Get available time slots for a doctor
patientsRouter.get(
    "/appointments/available-slots",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    getAvailableSlotsValidator,
    getAvailableSlotsController,
);

// Book appointment
patientsRouter.post(
    "/appointments/book",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    bookAppointmentValidator,
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

// Get list of verified doctors
patientsRouter.get(
    "/doctors",
    validateLoggedInUserMiddleware,
    validatePatientOrAdminRole,
    getVerifiedDoctorsController,
);

// Get patient profile
patientsRouter.get(
    "/profile",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    getPatientProfileController,
);

// Update patient profile
patientsRouter.put(
    "/profile",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    updatePatientProfileController,
);

module.exports = { patientsRouter };
