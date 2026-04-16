const express = require("express");
const {
    validateLoggedInUserMiddleware,
    validateDoctorRole,
} = require("../middlewares");
const {
    doctorDashboardController,
    getDoctorAppointmentsController,
    getTodayAppointmentsController,
    getUpcomingAppointmentsController,
    getAppointmentDetailController,
    completeAppointmentController,
    callTodayQueuePatientController,
    callNextQueuePatientController,
    startConsultationController,
    getDoctorProfileController,
    updateDoctorProfileController,
    activateEmergencyDelayController,
    deactivateEmergencyDelayController,
    getCustomReferencesController,
    addCustomReferenceController,
    getOwnAvailabilityController,
    updateOwnAvailabilityController,
    setOwnAvailabilityForDateController,
    addOwnAvailabilitySlotForDateController,
    removeOwnAvailabilitySlotForDateController,
} = require("./controllers");
const {
    updateDoctorProfileValidator,
    completeAppointmentValidator,
} = require("./dto");

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

// Get upcoming appointments
doctorsRouter.get(
    "/appointments/upcoming",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    getUpcomingAppointmentsController,
);

// Queue controls
doctorsRouter.post(
    "/appointments/queue/next-call",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    callNextQueuePatientController,
);

doctorsRouter.post(
    "/appointments/:appointmentId/call",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    callTodayQueuePatientController,
);

doctorsRouter.post(
    "/appointments/:appointmentId/start-consultation",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    startConsultationController,
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
    completeAppointmentValidator,
    completeAppointmentController,
);

// Get doctor profile
doctorsRouter.get(
    "/profile",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    getDoctorProfileController,
);

// Update doctor profile
doctorsRouter.put(
    "/profile",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    updateDoctorProfileValidator,
    updateDoctorProfileController,
);

// Emergency Delay
doctorsRouter.post(
    "/emergency-delay/activate",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    activateEmergencyDelayController,
);

doctorsRouter.post(
    "/emergency-delay/deactivate",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    deactivateEmergencyDelayController,
);

// Custom references
doctorsRouter.get(
    "/references",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    getCustomReferencesController,
);

doctorsRouter.post(
    "/references",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    addCustomReferenceController,
);

// Availability
doctorsRouter.get(
    "/availability",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    getOwnAvailabilityController,
);

doctorsRouter.put(
    "/availability",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    updateOwnAvailabilityController,
);

doctorsRouter.put(
    "/availability/date",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    setOwnAvailabilityForDateController,
);

doctorsRouter.post(
    "/availability/date/slot",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    addOwnAvailabilitySlotForDateController,
);

doctorsRouter.delete(
    "/availability/date/slot",
    validateLoggedInUserMiddleware,
    validateDoctorRole,
    removeOwnAvailabilitySlotForDateController,
);

module.exports = {
    doctorsRouter,
};
