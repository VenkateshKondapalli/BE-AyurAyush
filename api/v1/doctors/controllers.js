const {
    getDoctorDashboard,
    getDoctorAppointments,
    getTodayAppointments,
    getUpcomingAppointments,
    getAppointmentDetail,
    completeAppointment,
    callTodayQueuePatient,
    callNextQueuePatient,
    startConsultation,
    getDoctorProfile,
    updateDoctorProfile,
    activateEmergencyDelay,
    deactivateEmergencyDelay,
    getCustomReferences,
    addCustomReference,
    getOwnAvailability,
    updateOwnAvailability,
    setOwnAvailabilityForDate,
    addOwnAvailabilitySlotForDate,
    removeOwnAvailabilitySlotForDate,
    markNoShowByDoctor,
    getDoctorNotifications,
} = require("./services");
const logger = require("../../../utils/logger");

const doctorDashboardController = async (req, res, next) => {
    try {
        const { page, limit } = req.query;
        const data = await getDoctorDashboard(req.currentDoctor.userId, { page, limit });
        res.status(200).json({
            isSuccess: true,
            message: "Doctor dashboard loaded successfully",
            data,
        });
    } catch (err) {
        logger.error("Error in doctorDashboardController", {
            error: err.message,
        });
        next(err);
    }
};

const getDoctorAppointmentsController = async (req, res, next) => {
    try {
        const { status, date, urgencyLevel, patientName, page, limit, pastOnly } = req.query;
        const data = await getDoctorAppointments(req.currentDoctor.userId, {
            status,
            date,
            urgencyLevel,
            patientName,
            page,
            limit,
            pastOnly,
        });
        res.status(200).json({
            isSuccess: true,
            message: "Appointments retrieved successfully",
            data,
        });
    } catch (err) {
        logger.error("Error in getDoctorAppointmentsController", {
            error: err.message,
        });
        next(err);
    }
};

const getTodayAppointmentsController = async (req, res, next) => {
    try {
        const data = await getTodayAppointments(req.currentDoctor.userId);
        res.status(200).json({
            isSuccess: true,
            message: "Today's appointments retrieved",
            data,
        });
    } catch (err) {
        logger.error("Error in getTodayAppointmentsController", {
            error: err.message,
        });
        next(err);
    }
};

const getUpcomingAppointmentsController = async (req, res, next) => {
    try {
        const { date, page, limit } = req.query;
        const data = await getUpcomingAppointments(req.currentDoctor.userId, {
            date,
            page,
            limit,
        });
        res.status(200).json({
            isSuccess: true,
            message: "Upcoming appointments retrieved successfully",
            data,
        });
    } catch (err) {
        logger.error("Error in getUpcomingAppointmentsController", {
            error: err.message,
        });
        next(err);
    }
};

const getAppointmentDetailController = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;
        const data = await getAppointmentDetail(
            req.currentDoctor.userId,
            appointmentId,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Appointment details retrieved",
            data,
        });
    } catch (err) {
        logger.error("Error in getAppointmentDetailController", {
            error: err.message,
        });
        next(err);
    }
};

const completeAppointmentController = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;
        const { doctorNotes, prescription } = req.body;
        const data = await completeAppointment(
            req.currentDoctor.userId,
            appointmentId,
            {
                doctorNotes,
                prescription,
            },
        );
        res.status(200).json({
            isSuccess: true,
            message: "Appointment marked as completed",
            data,
        });
    } catch (err) {
        logger.error("Error in completeAppointmentController", {
            error: err.message,
        });
        next(err);
    }
};

const callTodayQueuePatientController = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;
        const data = await callTodayQueuePatient(
            req.currentDoctor.userId,
            appointmentId,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Patient called successfully",
            data,
        });
    } catch (err) {
        logger.error("Error in callTodayQueuePatientController", {
            error: err.message,
        });
        next(err);
    }
};

const callNextQueuePatientController = async (req, res, next) => {
    try {
        const data = await callNextQueuePatient(req.currentDoctor.userId);
        res.status(200).json({
            isSuccess: true,
            message: "Next patient called successfully",
            data,
        });
    } catch (err) {
        logger.error("Error in callNextQueuePatientController", {
            error: err.message,
        });
        next(err);
    }
};

const startConsultationController = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;
        const data = await startConsultation(
            req.currentDoctor.userId,
            appointmentId,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Consultation started",
            data,
        });
    } catch (err) {
        logger.error("Error in startConsultationController", {
            error: err.message,
        });
        next(err);
    }
};

const getDoctorProfileController = async (req, res, next) => {
    try {
        const data = await getDoctorProfile(req.currentDoctor.userId);
        res.status(200).json({
            isSuccess: true,
            message: "Doctor profile retrieved",
            data,
        });
    } catch (err) {
        logger.error("Error in getDoctorProfileController", {
            error: err.message,
        });
        next(err);
    }
};

const updateDoctorProfileController = async (req, res, next) => {
    try {
        const data = await updateDoctorProfile(
            req.currentDoctor.userId,
            req.body,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Doctor profile updated successfully",
            data,
        });
    } catch (err) {
        logger.error("Error in updateDoctorProfileController", {
            error: err.message,
        });
        next(err);
    }
};

const activateEmergencyDelayController = async (req, res, next) => {
    try {
        const { reason } = req.body;
        const data = await activateEmergencyDelay(
            req.currentDoctor.userId,
            reason,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Emergency delay activated",
            data,
        });
    } catch (err) {
        logger.error("Error in activateEmergencyDelayController", {
            error: err.message,
        });
        next(err);
    }
};

const deactivateEmergencyDelayController = async (req, res, next) => {
    try {
        const data = await deactivateEmergencyDelay(req.currentDoctor.userId);
        res.status(200).json({
            isSuccess: true,
            message: "Emergency delay deactivated",
            data,
        });
    } catch (err) {
        logger.error("Error in deactivateEmergencyDelayController", {
            error: err.message,
        });
        next(err);
    }
};

const getOwnAvailabilityController = async (req, res, next) => {
    try {
        const data = await getOwnAvailability(
            req.currentDoctor.userId,
            req.query.date,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Availability fetched successfully",
            data,
        });
    } catch (err) {
        logger.error("Error in getOwnAvailabilityController", {
            error: err.message,
        });
        next(err);
    }
};

const setOwnAvailabilityForDateController = async (req, res, next) => {
    try {
        const data = await setOwnAvailabilityForDate(
            req.currentDoctor.userId,
            req.body,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Date availability updated successfully",
            data,
        });
    } catch (err) {
        logger.error("Error in setOwnAvailabilityForDateController", {
            error: err.message,
        });
        next(err);
    }
};

const addOwnAvailabilitySlotForDateController = async (req, res, next) => {
    try {
        const data = await addOwnAvailabilitySlotForDate(
            req.currentDoctor.userId,
            req.body,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Slot added successfully",
            data,
        });
    } catch (err) {
        logger.error("Error in addOwnAvailabilitySlotForDateController", {
            error: err.message,
        });
        next(err);
    }
};

const removeOwnAvailabilitySlotForDateController = async (req, res, next) => {
    try {
        const data = await removeOwnAvailabilitySlotForDate(
            req.currentDoctor.userId,
            req.body,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Slot removed successfully",
            data,
        });
    } catch (err) {
        logger.error("Error in removeOwnAvailabilitySlotForDateController", {
            error: err.message,
        });
        next(err);
    }
};

const updateOwnAvailabilityController = async (req, res, next) => {
    try {
        const data = await updateOwnAvailability(
            req.currentDoctor.userId,
            req.body,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Availability updated successfully",
            data,
        });
    } catch (err) {
        logger.error("Error in updateOwnAvailabilityController", {
            error: err.message,
        });
        next(err);
    }
};

const getCustomReferencesController = async (req, res, next) => {
    try {
        const data = await getCustomReferences(req.currentDoctor.userId);
        res.status(200).json({
            isSuccess: true,
            message: "Custom references retrieved",
            data,
        });
    } catch (err) {
        logger.error("Error in getCustomReferencesController", {
            error: err.message,
        });
        next(err);
    }
};

const addCustomReferenceController = async (req, res, next) => {
    try {
        const { activeTab, itemPayload } = req.body;
        const data = await addCustomReference(
            req.currentDoctor.userId,
            activeTab,
            itemPayload,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Custom reference added successfully",
            data,
        });
    } catch (err) {
        logger.error("Error in addCustomReferenceController", {
            error: err.message,
        });
        next(err);
    }
};

const markNoShowByDoctorController = async (req, res, next) => {
    try {
        const { appointmentId } = req.params;
        const data = await markNoShowByDoctor(req.currentDoctor.userId, appointmentId);
        res.status(200).json({
            isSuccess: true,
            message: "Appointment flagged as not visited. Admin will review and confirm.",
            data,
        });
    } catch (err) {
        logger.error("Error in markNoShowByDoctorController", { error: err.message });
        next(err);
    }
};

const getDoctorNotificationsController = async (req, res, next) => {
    try {
        const data = await getDoctorNotifications(req.currentDoctor.userId);
        res.status(200).json({ isSuccess: true, message: "Notifications retrieved", data });
    } catch (err) { logger.error("Error in getDoctorNotificationsController", { error: err.message }); next(err); }
};

module.exports = {
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
    markNoShowByDoctorController,
    getDoctorNotificationsController,
};
