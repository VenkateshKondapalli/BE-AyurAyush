const {
    getDoctorDashboard,
    getDoctorAppointments,
    getTodayAppointments,
    getAppointmentDetail,
    completeAppointment,
    callTodayQueuePatient,
    callNextQueuePatient,
    startConsultation,
    getDoctorProfile,
    updateDoctorProfile,
} = require("./services");
const logger = require("../../../utils/logger");

const doctorDashboardController = async (req, res, next) => {
    try {
        const data = await getDoctorDashboard(req.currentDoctor.userId);
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
        const { status, date, page, limit } = req.query;
        const data = await getDoctorAppointments(req.currentDoctor.userId, {
            status,
            date,
            page,
            limit,
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

module.exports = {
    doctorDashboardController,
    getDoctorAppointmentsController,
    getTodayAppointmentsController,
    getAppointmentDetailController,
    completeAppointmentController,
    callTodayQueuePatientController,
    callNextQueuePatientController,
    startConsultationController,
    getDoctorProfileController,
    updateDoctorProfileController,
};
