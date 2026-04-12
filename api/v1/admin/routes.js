const express = require("express");
const {
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
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
    offlineBookAppointmentController,
    getTodayQueueController,
    callPatientController,
    getQueueInsightsController,
    getAppointmentAuditTrailController,
    batchDecideAppointmentsController,
} = require("./controllers");
const {
    rejectAppointmentValidator,
    offlineBookValidator,
    createDoctorAccountValidator,
    setDoctorAvailabilityValidator,
} = require("./dto");

const adminsRouter = express.Router();

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

adminsRouter.get(
    "/doctor-applications",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    reviewDoctorApplicationsController,
);

adminsRouter.get(
    "/doctors",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    getVerifiedDoctorsController,
);

adminsRouter.get(
    "/doctors/:doctorId/available-slots",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    getDoctorAvailableSlotsController,
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
    "/appointments/today-queue",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    getTodayQueueController,
);

adminsRouter.post(
    "/appointments/:appointmentId/call",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    callPatientController,
);

adminsRouter.get(
    "/appointments/queue-insights",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    getQueueInsightsController,
);

adminsRouter.get(
    "/appointments/:appointmentId/audit-trail",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    getAppointmentAuditTrailController,
);

adminsRouter.post(
    "/appointments/batch-decision",
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    batchDecideAppointmentsController,
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
    setDoctorAvailabilityValidator,
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
