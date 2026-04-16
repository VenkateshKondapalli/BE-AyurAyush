const express = require("express");
const {
    validateLoggedInUserMiddleware,
    validatePatientRole,
} = require("../middlewares");
const {
    patientDashboardController,
    getAvailableSlotsController,
    bookAppointmentController,
    cancelAppointmentController,
    getAppointmentDetailsController,
    getPatientAppointmentsController,
    getVerifiedDoctorsController,
    getPatientProfileController,
    updatePatientProfileController,
    getTreatmentSuggestionsController,
    getEmergencyDelayForDoctorController,
} = require("./controllers");
const {
    bookAppointmentValidator,
    getAvailableSlotsValidator,
    updatePatientProfileValidator,
} = require("./dto");

const patientsRouter = express.Router();

patientsRouter.get(
    "/dashboard",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    patientDashboardController,
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
    validatePatientRole,
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
    updatePatientProfileValidator,
    updatePatientProfileController,
);

// Get treatment suggestions from a completed conversation
patientsRouter.get(
    "/treatment-suggestions",
    validateLoggedInUserMiddleware,
    validatePatientRole,
    getTreatmentSuggestionsController,
);

// Get emergency delay status for a doctor
patientsRouter.get(
    "/emergency-delay/:doctorId",
    validateLoggedInUserMiddleware,
    getEmergencyDelayForDoctorController,
);

module.exports = { patientsRouter };
