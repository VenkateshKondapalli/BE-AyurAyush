const {
    getPatientDashboard,
    applyForDoctorRole,
    getAvailableSlots,
    bookAppointment,
    getPatientAppointments,
    getAppointmentDetails,
    cancelAppointment,
    getVerifiedDoctors,
    getPatientProfile,
    updatePatientProfile,
    getTreatmentSuggestionsForPatient,
    getEmergencyDelayForDoctor,
    getPatientNotifications,
} = require("./services");

const patientDashboardController = async (req, res, next) => {
    try {
        const data = await getPatientDashboard(req.currentPatient.userId);
        res.status(200).json({
            isSuccess: true,
            message: "Patient dashboard loaded successfully",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const applyForDoctorRoleController = async (req, res, next) => {
    try {
        res.status(410).json({
            isSuccess: false,
            message:
                "This flow is disabled for MVP. Doctor onboarding is now managed by admin after offline verification.",
        });
    } catch (err) {
        next(err);
    }
};

const getAvailableSlotsController = async (req, res, next) => {
    try {
        const { doctorId, date } = req.query;
        const data = await getAvailableSlots(doctorId, date);
        res.status(200).json({
            isSuccess: true,
            message: "Available slots retrieved",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const bookAppointmentController = async (req, res, next) => {
    try {
        const data = await bookAppointment(req.currentPatient.userId, req.body);
        const message =
            data.urgencyLevel === "emergency"
                ? "Emergency appointment created! Waiting for admin approval."
                : "Appointment booked successfully! Waiting for admin approval.";
        res.status(201).json({ isSuccess: true, message, data });
    } catch (err) {
        next(err);
    }
};

const getPatientAppointmentsController = async (req, res, next) => {
    try {
        const data = await getPatientAppointments(
            req.currentPatient.userId,
            req.query.status,
            req.query,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Appointments retrieved successfully",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getAppointmentDetailsController = async (req, res, next) => {
    try {
        const data = await getAppointmentDetails(
            req.currentPatient.userId,
            req.params.appointmentId,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Appointment details retrieved",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const cancelAppointmentController = async (req, res, next) => {
    try {
        await cancelAppointment(
            req.currentPatient.userId,
            req.params.appointmentId,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Appointment cancelled successfully",
        });
    } catch (err) {
        next(err);
    }
};

const getVerifiedDoctorsController = async (req, res, next) => {
    try {
        const data = await getVerifiedDoctors(
            req.query.specialization,
            req.query,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Verified doctors retrieved",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getPatientProfileController = async (req, res, next) => {
    try {
        const data = await getPatientProfile(req.currentPatient.userId);
        res.status(200).json({
            isSuccess: true,
            message: "Patient profile retrieved",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const updatePatientProfileController = async (req, res, next) => {
    try {
        const data = await updatePatientProfile(
            req.currentPatient.userId,
            req.body,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Patient profile updated successfully",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getTreatmentSuggestionsController = async (req, res, next) => {
    try {
        const { conversationId } = req.query;
        if (!conversationId) {
            return res.status(400).json({
                isSuccess: false,
                message: "conversationId query parameter is required",
            });
        }
        const data = await getTreatmentSuggestionsForPatient(
            conversationId,
            req.currentPatient.userId,
        );
        res.status(200).json({
            isSuccess: true,
            message: "Treatment suggestions retrieved",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getEmergencyDelayForDoctorController = async (req, res, next) => {
    try {
        const { doctorId } = req.params;
        const data = await getEmergencyDelayForDoctor(doctorId);
        res.status(200).json({
            isSuccess: true,
            message: "Doctor emergency delay status retrieved",
            data,
        });
    } catch (err) {
        next(err);
    }
};

const getPatientNotificationsController = async (req, res, next) => {
    try {
        const data = await getPatientNotifications(req.currentPatient.userId);
        res.status(200).json({ isSuccess: true, message: "Notifications retrieved", data });
    } catch (err) { next(err); }
};

module.exports = {
    patientDashboardController,
    applyForDoctorRoleController,
    getAvailableSlotsController,
    bookAppointmentController,
    getPatientAppointmentsController,
    getAppointmentDetailsController,
    cancelAppointmentController,
    getVerifiedDoctorsController,
    getPatientProfileController,
    updatePatientProfileController,
    getTreatmentSuggestionsController,
    getEmergencyDelayForDoctorController,
    getPatientNotificationsController,
};
