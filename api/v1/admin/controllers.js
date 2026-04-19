const {
    getDashboardStats,
    getSubAdminDashboard,
    createDoctorAccountByAdmin,
    getPendingDoctorApplications,
    approveDoctorApplication,
    rejectDoctorApplication,
    getPendingNormalAppointments,
    getEmergencyAppointments,
    approveAppointment,
    rejectAppointment,
    setDoctorAvailability,
    getDoctorAvailabilityForAdmin,
    setDoctorAvailabilityForDateByAdmin,
    addDoctorAvailabilitySlotForDateByAdmin,
    removeDoctorAvailabilitySlotForDateByAdmin,
    offlineBookAppointment,
    getVerifiedDoctorsForAdmin,
    getDoctorAvailableSlotsForAdmin,
    getTodayQueue,
    callTodayQueuePatient,
    getQueueInsights,
    getAppointmentAuditTrail,
    batchDecideAppointments,
    getEmergencyDelays,
    getOverdueAppointments,
    cancelOverdueAppointments,
    getPastAppointments,
    markNoShowAndRefund,
    getAdminNotifications,
} = require("./services");

const subAdminDashboardController = async (req, res, next) => {
    try {
        const data = await getSubAdminDashboard(req.subAdminProfile);
        res.status(200).json({ isSuccess: true, message: "Sub-admin dashboard loaded", data });
    } catch (err) {
        next(err);
    }
};

const adminDashboardController = async (req, res, next) => {
    try {
        const dashboard = await getDashboardStats();
        res.status(200).json({
            isSuccess: true,
            message: "Admin dashboard loaded successfully",
            data: {
                dashboard,
                stats: dashboard.stats,
            },
        });
    } catch (err) {
        next(err);
    }
};

const createDoctorAccountController = async (req, res, next) => {
    try {
        const data = await createDoctorAccountByAdmin(
            req.currentAdmin.userId,
            req.body,
        );

        res.status(201).json({
            isSuccess: true,
            message:
                "Doctor account created and onboarding email sent successfully",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const reviewDoctorApplicationsController = async (req, res, next) => {
    try {
        const applications = await getPendingDoctorApplications();
        res.status(200).json({
            isSuccess: true,
            message: "Pending doctor applications fetched",
            data: { applications },
        });
    } catch (err) {
        next(err);
    }
};

const approveDoctorApplicationController = async (req, res, next) => {
    try {
        const { applicationId } = req.params;
        await approveDoctorApplication(applicationId, req.currentAdmin.userId);
        res.status(200).json({
            isSuccess: true,
            message: "Doctor application approved successfully",
        });
    } catch (err) {
        next(err);
    }
};

const rejectDoctorApplicationController = async (req, res, next) => {
    try {
        const { applicationId } = req.params;
        await rejectDoctorApplication(applicationId, req.currentAdmin.userId);
        res.status(200).json({
            isSuccess: true,
            message: "Doctor application rejected",
        });
    } catch (err) {
        next(err);
    }
};

const getPendingNormalAppointmentsController = async (req, res, next) => {
    try {
        const data = await getPendingNormalAppointments(req.query);
        res.status(200).json({
            isSuccess: true,
            message: "Pending appointments retrieved",
            data: {
                queueType: "normal",
                ...data,
            },
        });
    } catch (err) {
        next(err);
    }
};

const getEmergencyAppointmentsController = async (req, res, next) => {
    try {
        const data = await getEmergencyAppointments(req.query);
        res.status(200).json({
            isSuccess: true,
            message: "Emergency appointments retrieved",
            data: {
                queueType: "emergency",
                ...data,
                alert:
                    data.count > 0
                        ? "Emergency appointments require immediate review!"
                        : null,
            },
        });
    } catch (err) {
        next(err);
    }
};

const approveAppointmentController = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;
        const { edits, adminNotes } = req.body;
        const data = await approveAppointment(
            appointmentId,
            req.currentAdmin.userId,
            edits,
            adminNotes,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Appointment approved successfully",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const rejectAppointmentController = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;
        const { reason } = req.body;
        const data = await rejectAppointment(
            appointmentId,
            req.currentAdmin.userId,
            reason,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Appointment rejected",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const setDoctorAvailabilityController = async (req, res, next) => {
    try {
        const { doctorId } = req.params;
        const { availableDays, timeSlots, unavailableDates } = req.body;
        const data = await setDoctorAvailability(
            doctorId,
            req.currentAdmin.userId,
            { availableDays, timeSlots, unavailableDates },
        );
        res.status(200).json({
            isSuccess: true,
            message: "Doctor availability updated successfully",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getVerifiedDoctorsController = async (req, res, next) => {
    try {
        const data = await getVerifiedDoctorsForAdmin(req.query);
        res.status(200).json({
            isSuccess: true,
            message: "Verified doctors retrieved",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getDoctorAvailableSlotsController = async (req, res, next) => {
    try {
        const { doctorId } = req.params;
        const { date } = req.query;
        const data = await getDoctorAvailableSlotsForAdmin(doctorId, date);
        res.status(200).json({
            isSuccess: true,
            message: "Available slots retrieved",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getDoctorAvailabilityController = async (req, res, next) => {
    try {
        const { doctorId } = req.params;
        const { date } = req.query;
        const data = await getDoctorAvailabilityForAdmin(doctorId, date);
        res.status(200).json({
            isSuccess: true,
            message: "Doctor availability retrieved",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const setDoctorAvailabilityForDateController = async (req, res, next) => {
    try {
        const { doctorId } = req.params;
        const data = await setDoctorAvailabilityForDateByAdmin(
            doctorId,
            req.currentAdmin.userId,
            req.body,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Doctor date availability updated",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const addDoctorAvailabilityDateSlotController = async (req, res, next) => {
    try {
        const { doctorId } = req.params;
        const data = await addDoctorAvailabilitySlotForDateByAdmin(
            doctorId,
            req.currentAdmin.userId,
            req.body,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Doctor date slot added",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const removeDoctorAvailabilityDateSlotController = async (req, res, next) => {
    try {
        const { doctorId } = req.params;
        const data = await removeDoctorAvailabilitySlotForDateByAdmin(
            doctorId,
            req.currentAdmin.userId,
            req.body,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Doctor date slot removed",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const offlineBookAppointmentController = async (req, res, next) => {
    try {
        const data = await offlineBookAppointment(
            req.currentAdmin.userId,
            req.body,
        );
        res.status(201).json({
            isSuccess: true,
            message: "Offline appointment booked successfully",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getTodayQueueController = async (req, res, next) => {
    try {
        const data = await getTodayQueue();
        res.status(200).json({
            isSuccess: true,
            message: "Today's queue loaded successfully",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const callPatientController = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;
        const data = await callTodayQueuePatient(
            appointmentId,
            req.currentAdmin.userId,
        );
        res.status(200).json({
            isSuccess: true,
            message: data.firstCallEmailSent
                ? "Patient notified by email and in-app"
                : "Patient notified in-app",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getQueueInsightsController = async (req, res, next) => {
    try {
        const data = await getQueueInsights();
        res.status(200).json({
            isSuccess: true,
            message: "Queue insights loaded successfully",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getAppointmentAuditTrailController = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;
        const data = await getAppointmentAuditTrail(appointmentId);
        res.status(200).json({
            isSuccess: true,
            message: "Appointment audit trail loaded successfully",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const batchDecideAppointmentsController = async (req, res, next) => {
    try {
        const data = await batchDecideAppointments(
            req.currentAdmin.userId,
            req.body,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Batch decision processed",
            data,
        });
    } catch (err) {
        next(err);
    }
};
const getEmergencyDelaysController = async (req, res, next) => {
    try {
        const data = await getEmergencyDelays();
        res.status(200).json({
            isSuccess: true,
            message: "Active emergency delays retrieved",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getOverdueAppointmentsController = async (req, res, next) => {
    try {
        const data = await getOverdueAppointments(req.query);
        res.status(200).json({ isSuccess: true, message: "Overdue appointments retrieved", data });
    } catch (err) {
        next(err);
    }
};

const cancelOverdueAppointmentsController = async (req, res, next) => {
    try {
        const data = await cancelOverdueAppointments(req.currentAdmin.userId);
        res.status(200).json({
            isSuccess: true,
            message: `${data.cancelled} overdue appointment(s) cancelled. ${data.refunded} refund(s) initiated. ${data.notified} apology email(s) sent.`,
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getPastAppointmentsController = async (req, res, next) => {
    try {
        const data = await getPastAppointments(req.query);
        res.status(200).json({ isSuccess: true, message: "Past appointments retrieved", data });
    } catch (err) {
        next(err);
    }
};

const markNoShowController = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;
        const { reason } = req.body;
        const data = await markNoShowAndRefund(req.currentAdmin.userId, appointmentId, reason);
        res.status(200).json({
            isSuccess: true,
            message: `Appointment marked as no-show.${data.refundInitiated ? " Refund initiated." : ""} Notification sent to patient.`,
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getAdminNotificationsController = async (req, res, next) => {
    try {
        const data = await getAdminNotifications();
        res.status(200).json({ isSuccess: true, message: "Notifications retrieved", data });
    } catch (err) { next(err); }
};

module.exports = {
    subAdminDashboardController,
    adminDashboardController,
    createDoctorAccountController,
    reviewDoctorApplicationsController,
    approveDoctorApplicationController,
    rejectDoctorApplicationController,
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
    getVerifiedDoctorsController,
    getDoctorAvailableSlotsController,
    getTodayQueueController,
    callPatientController,
    getQueueInsightsController,
    getAppointmentAuditTrailController,
    batchDecideAppointmentsController,
    getEmergencyDelaysController,
    getOverdueAppointmentsController,
    cancelOverdueAppointmentsController,
    getPastAppointmentsController,
    markNoShowController,
    getAdminNotificationsController,
};
