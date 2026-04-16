const express = require("express");
const {
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    validateAnyAdminMiddleware,
    checkPermission,
} = require("../middlewares");
const {
    adminDashboardController,
    createDoctorAccountController,
    reviewDoctorApplicationsController,
    approveDoctorApplicationController,
    rejectDoctorApplicationController,
    getVerifiedDoctorsController,
    getDoctorAvailableSlotsController,
    getPendingNormalAppointmentsController,
    getEmergencyAppointmentsController,
    approveAppointmentController,
    rejectAppointmentController,
    setDoctorAvailabilityController,
    getDoctorAvailabilityController,
    setDoctorAvailabilityForDateController,
    addDoctorAvailabilityDateSlotController,
    removeDoctorAvailabilityDateSlotController,
    offlineBookAppointmentController,
    getQueueInsightsController,
    getAppointmentAuditTrailController,
    batchDecideAppointmentsController,
    getEmergencyDelaysController,
    callPatientController,
    getTodayQueueController,
} = require("./controllers");
const {
    rejectAppointmentValidator,
    offlineBookValidator,
    createDoctorAccountValidator,
    setDoctorAvailabilityValidator,
} = require("./dto");

const adminsRouter = express.Router();

// Super-admin only (existing behaviour unchanged)
adminsRouter.get(
    "/dashboard",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    adminDashboardController,
);

adminsRouter.post(
    "/doctors/create",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    createDoctorAccountValidator,
    createDoctorAccountController,
);

// Doctor applications — super-admin or sub-admin with viewDoctorApplications
adminsRouter.get(
    "/doctor-applications",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("viewDoctorApplications"),
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

// Doctors list — super-admin or sub-admin with viewDoctors
adminsRouter.get(
    "/doctors",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("viewDoctors"),
    getVerifiedDoctorsController,
);

adminsRouter.get(
    "/doctors/:doctorId/available-slots",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("viewDoctors"),
    getDoctorAvailableSlotsController,
);

// Availability management — super-admin or sub-admin with manageAvailability
adminsRouter.put(
    "/doctors/:doctorId/availability",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("manageAvailability"),
    setDoctorAvailabilityValidator,
    setDoctorAvailabilityController,
);

adminsRouter.get(
    "/doctors/:doctorId/availability",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("manageAvailability"),
    getDoctorAvailabilityController,
);

adminsRouter.put(
    "/doctors/:doctorId/availability/date",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("manageAvailability"),
    setDoctorAvailabilityForDateController,
);

adminsRouter.post(
    "/doctors/:doctorId/availability/date/slot",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("manageAvailability"),
    addDoctorAvailabilityDateSlotController,
);

adminsRouter.delete(
    "/doctors/:doctorId/availability/date/slot",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("manageAvailability"),
    removeDoctorAvailabilityDateSlotController,
);

// Queue viewing — sub-admin with viewQueues (filtered by queueScope in controller)
adminsRouter.get(
    "/appointments/today-queue",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("viewQueues"),
    getTodayQueueController,
);

adminsRouter.get(
    "/appointments/pending",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("viewQueues"),
    getPendingNormalAppointmentsController,
);

adminsRouter.get(
    "/appointments/emergency",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("viewQueues"),
    getEmergencyAppointmentsController,
);

adminsRouter.get(
    "/appointments/queue-insights",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("viewQueues"),
    getQueueInsightsController,
);

// Approve/Reject — sub-admin with approveAppointments
adminsRouter.post(
    "/appointments/:appointmentId/approve",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("approveAppointments"),
    approveAppointmentController,
);

adminsRouter.post(
    "/appointments/:appointmentId/reject",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("approveAppointments"),
    rejectAppointmentValidator,
    rejectAppointmentController,
);

adminsRouter.post(
    "/appointments/batch-decision",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("approveAppointments"),
    batchDecideAppointmentsController,
);

// Call patients — sub-admin with callPatients
adminsRouter.post(
    "/appointments/:appointmentId/call",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("callPatients"),
    callPatientController,
);

// Offline booking — sub-admin with offlineBooking
adminsRouter.post(
    "/appointments/offline-book",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("offlineBooking"),
    offlineBookValidator,
    offlineBookAppointmentController,
);

// Audit trail + emergency delays — any admin
adminsRouter.get(
    "/appointments/:appointmentId/audit-trail",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("viewQueues"),
    getAppointmentAuditTrailController,
);

adminsRouter.get(
    "/emergency-delays",
    validateLoggedInUserMiddleware,
    validateAnyAdminMiddleware,
    checkPermission("viewQueues"),
    getEmergencyDelaysController,
);

module.exports = { adminsRouter };
