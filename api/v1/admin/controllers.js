const {
  getDashboardStats,
  getPendingDoctorApplications,
  approveDoctorApplication,
  rejectDoctorApplication,
  getPendingNormalAppointments,
  getEmergencyAppointments,
  approveAppointment,
  rejectAppointment,
  setDoctorAvailability,
  offlineBookAppointment,
} = require("./services");

const adminDashboardController = async (req, res, next) => {
  try {
    const stats = await getDashboardStats();
    res.status(200).json({
      isSuccess: true,
      message: "Admin dashboard loaded successfully",
      data: { stats },
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
    const appointments = await getPendingNormalAppointments();
    res.status(200).json({
      isSuccess: true,
      message: "Pending appointments retrieved",
      data: {
        queueType: "normal",
        count: appointments.length,
        appointments,
      },
    });
  } catch (err) {
    next(err);
  }
};

const getEmergencyAppointmentsController = async (req, res, next) => {
  try {
    const appointments = await getEmergencyAppointments();
    res.status(200).json({
      isSuccess: true,
      message: "Emergency appointments retrieved",
      data: {
        queueType: "emergency",
        count: appointments.length,
        appointments,
        alert:
          appointments.length > 0
            ? "⚠️ Emergency appointments require immediate review!"
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

module.exports = {
  adminDashboardController,
  reviewDoctorApplicationsController,
  approveDoctorApplicationController,
  rejectDoctorApplicationController,
  getPendingNormalAppointmentsController,
  getEmergencyAppointmentsController,
  approveAppointmentController,
  rejectAppointmentController,
  setDoctorAvailabilityController,
  offlineBookAppointmentController,
};
