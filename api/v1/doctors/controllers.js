const { AppointmentModel } = require("../../../models/appointmentSchema");
const { ChatHistoryModel } = require("../../../models/chatHistorySchema");
const { DoctorModel } = require("../../../models/doctorSchema");
const { PatientModel } = require("../../../models/patientSchema");
const { UserModel } = require("../../../models/userSchema");

const doctorDashboardController = async (req, res) => {
  try {
    console.log("-----🟢 inside doctorDashboardController-------");

    const { userId } = req.currentDoctor;

    let doctor = await DoctorModel.findOne({ userId });

    if (!doctor) {
      console.log("🟡 Doctor profile not found, creating new one");

      doctor = await DoctorModel.create({
        userId,
        specialization: null,
        experience: null,
        isVerified: false,
      });
    }

    res.status(200).json({
      isSuccess: true,
      message: "Doctor dashboard loaded successfully",
      data: {
        doctorId: doctor._id,
        userId: doctor.userId,
        specialization: doctor.specialization,
        experience: doctor.experience,
        isVerified: doctor.isVerified,
        createdAt: doctor.createdAt,
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in doctorDashboardController--------");
    console.error(err);

    if (err.code === 11000) {
      return res.status(409).json({
        isSuccess: false,
        message: "Doctor profile already exists",
      });
    }

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const getDoctorAppointmentsController = async (req, res) => {
  try {
    console.log("-----🟢 inside getDoctorAppointmentsController-------");

    const { userId } = req.currentDoctor;
    const { status, date } = req.query;

    const query = {
      doctorId: userId,
      status: { $nin: ["rejected"] },
    };

    if (status) {
      query.status = status;
    }

    if (date) {
      query.date = {
        $gte: new Date(date).setHours(0, 0, 0, 0),
        $lte: new Date(date).setHours(23, 59, 59, 999),
      };
    }

    const appointments = await appointmentModel
      .find(query)
      .populate("patientId", "name email phone gender dob profilePhoto")
      .sort({ date: 1, timeSlot: 1 });

    const appointmentsWithDetails = await Promise.all(
      appointments.map(async (apt) => {
        const patientProfile = await PatientModel.findOne({
          userId: apt.patientId._id,
        }).select("bloodGroup allergies medicalHistory");

        return {
          appointmentId: apt._id,
          status: apt.status,
          urgencyLevel: apt.urgencyLevel,
          patient: {
            id: apt.patientId._id,
            name: apt.patientId.name,
            email: apt.patientId.email,
            phone: apt.patientId.phone,
            gender: apt.patientId.gender,
            age: calculateAge(apt.patientId.dob),
            profilePhoto: apt.patientId.profilePhoto,
            bloodGroup: patientProfile?.bloodGroup,
            allergies: patientProfile?.allergies || [],
          },
          appointmentDetails: {
            date: apt.date,
            timeSlot: apt.timeSlot,
            symptoms: apt.symptoms,
            aiSummary: apt.aiSummary,
          },
          isEmergency: apt.urgencyLevel === "emergency",
          createdAt: apt.createdAt,
        };
      }),
    );

    const emergencyAppointments = appointmentsWithDetails.filter(
      (apt) => apt.urgencyLevel === "emergency",
    );
    const normalAppointments = appointmentsWithDetails.filter(
      (apt) => apt.urgencyLevel === "normal",
    );

    res.status(200).json({
      isSuccess: true,
      message: "Appointments retrieved successfully",
      data: {
        totalCount: appointmentsWithDetails.length,
        emergencyCount: emergencyAppointments.length,
        normalCount: normalAppointments.length,
        emergencyAppointments,
        normalAppointments,
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in getDoctorAppointmentsController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const getTodayAppointmentsController = async (req, res) => {
  try {
    console.log("-----🟢 inside getTodayAppointmentsController-------");

    const { userId } = req.currentDoctor;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const appointments = await appointmentModel
      .find({
        doctorId: userId,
        status: "confirmed",
        date: {
          $gte: todayStart,
          $lte: todayEnd,
        },
      })
      .populate("patientId", "name email phone gender dob profilePhoto")
      .sort({ timeSlot: 1 });

    const appointmentsWithDetails = await Promise.all(
      appointments.map(async (apt) => {
        const patientProfile = await PatientModel.findOne({
          userId: apt.patientId._id,
        }).select("bloodGroup allergies emergencyContact");

        return {
          appointmentId: apt._id,
          urgencyLevel: apt.urgencyLevel,
          timeSlot: apt.timeSlot,
          patient: {
            id: apt.patientId._id,
            name: apt.patientId.name,
            phone: apt.patientId.phone,
            gender: apt.patientId.gender,
            age: calculateAge(apt.patientId.dob),
            bloodGroup: patientProfile?.bloodGroup,
            allergies: patientProfile?.allergies || [],
            emergencyContact: patientProfile?.emergencyContact,
          },
          symptoms: apt.symptoms,
          aiSummary: apt.aiSummary,
          isEmergency: apt.urgencyLevel === "emergency",
        };
      }),
    );

    res.status(200).json({
      isSuccess: true,
      message: "Today's appointments retrieved",
      data: {
        date: new Date().toISOString().split("T")[0],
        totalCount: appointmentsWithDetails.length,
        appointments: appointmentsWithDetails,
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in getTodayAppointmentsController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const getAppointmentDetailController = async (req, res) => {
  try {
    console.log("-----🟢 inside getAppointmentDetailController-------");

    const { userId } = req.currentDoctor;
    const { appointmentId } = req.params;

    const appointment = await appointmentModel
      .findOne({
        _id: appointmentId,
        doctorId: userId,
      })
      .populate("patientId", "name email phone gender dob profilePhoto");

    if (!appointment) {
      return res.status(404).json({
        isSuccess: false,
        message: "Appointment not found",
      });
    }

    const patientProfile = await PatientModel.findOne({
      userId: appointment.patientId._id,
    });

    const chatHistory = await ChatHistoryModel.findOne({
      conversationId: appointment.chatConversationId,
    });

    res.status(200).json({
      isSuccess: true,
      message: "Appointment details retrieved",
      data: {
        appointment: {
          id: appointment._id,
          status: appointment.status,
          urgencyLevel: appointment.urgencyLevel,
          date: appointment.date,
          timeSlot: appointment.timeSlot,
          symptoms: appointment.symptoms,
          aiSummary: appointment.aiSummary,
          doctorNotes: appointment.doctorNotes,
          prescription: appointment.prescription,
        },
        patient: {
          id: appointment.patientId._id,
          name: appointment.patientId.name,
          email: appointment.patientId.email,
          phone: appointment.patientId.phone,
          gender: appointment.patientId.gender,
          age: calculateAge(appointment.patientId.dob),
          profilePhoto: appointment.patientId.profilePhoto,
          bloodGroup: patientProfile?.bloodGroup,
          allergies: patientProfile?.allergies || [],
          medicalHistory: patientProfile?.medicalHistory || [],
          emergencyContact: patientProfile?.emergencyContact,
        },
        chatDetails: {
          conversationId: chatHistory?.conversationId,
          fullConversation: chatHistory?.messages,
          summary: chatHistory?.summary,
        },
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in getAppointmentDetailController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const completeAppointmentController = async (req, res) => {
  try {
    console.log("-----🟢 inside completeAppointmentController-------");

    const { userId } = req.currentDoctor;
    const { appointmentId } = req.params;
    const { doctorNotes, prescription } = req.body;

    const appointment = await appointmentModel.findOne({
      _id: appointmentId,
      doctorId: userId,
    });

    if (!appointment) {
      return res.status(404).json({
        isSuccess: false,
        message: "Appointment not found",
      });
    }

    if (appointment.status !== "confirmed") {
      return res.status(400).json({
        isSuccess: false,
        message: "Only confirmed appointments can be completed",
      });
    }

    await appointment.markCompleted(prescription, doctorNotes);

    res.status(200).json({
      isSuccess: true,
      message: "Appointment marked as completed",
      data: {
        appointmentId: appointment._id,
        status: appointment.status,
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in completeAppointmentController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const calculateAge = (dob) => {
  if (!dob) return null;
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }
  return age;
};

module.exports = {
  doctorDashboardController,
  getDoctorAppointmentsController,
  getTodayAppointmentsController,
  getAppointmentDetailController,
  completeAppointmentController,
};
