const {
  getDoctorDashboard,
  getDoctorAppointments,
  getTodayAppointments,
  getAppointmentDetail,
  completeAppointment,
} = require("./services");

const doctorDashboardController = async (req, res, next) => {
  try {
    const data = await getDoctorDashboard(req.currentDoctor.userId);
    res.status(200).json({
      isSuccess: true,
      message: "Doctor dashboard loaded successfully",
      data,
    });
  } catch (err) {
    next(err);
  }
};

const getDoctorAppointmentsController = async (req, res, next) => {
  try {
    const { status, date } = req.query;
    const data = await getDoctorAppointments(req.currentDoctor.userId, {
      status,
      date,
    });
    res.status(200).json({
      isSuccess: true,
      message: "Appointments retrieved successfully",
      data,
    });
  } catch (err) {
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
    next(err);
  }
};

module.exports = {
  doctorDashboardController,
  getDoctorAppointmentsController,
  getTodayAppointmentsController,
  getAppointmentDetailController,
  completeAppointmentController,
};
