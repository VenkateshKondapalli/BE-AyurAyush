const { AppointmentModel } = require("../../../models/appointmentSchema");
const { ChatHistoryModel } = require("../../../models/chatHistorySchema");
const {
  DoctorApplicationsModel,
} = require("../../../models/doctorApplicationSchema");
const {
  DoctorAvailabiltyModel,
} = require("../../../models/doctorAvailabilitySchema");
const { DoctorModel } = require("../../../models/doctorSchema");
const { PatientModel } = require("../../../models/patientSchema");
const { UserModel } = require("../../../models/userSchema");

const patientDashboardController = async (req, res) => {
  try {
    console.log("-----🟢 inside patientDashboardController-------");

    const { userId } = req.currentUser;

    let patient = await PatientModel.findOne({ userId });

    if (!patient) {
      console.log("🟡 Patient profile not found, creating new one");

      patient = await PatientModel.create({
        userId,
        bloodGroup: null,
        medicalHistory: [],
        allergies: [],
        emergencyContact: {},
      });
    }

    res.status(200).json({
      isSuccess: true,
      message: "Patient dashboard loaded successfully",
      data: {
        patientId: patient._id,
        userId: patient.userId,
        bloodGroup: patient.bloodGroup,
        medicalHistory: patient.medicalHistory,
        allergies: patient.allergies,
        emergencyContact: patient.emergencyContact,
        createdAt: patient.createdAt,
      },
    });
  } catch (err) {
    console.error(err);

    if (err.code === 11000) {
      return res.status(409).json({
        isSuccess: false,
        message: "Patient profile already exists",
      });
    }

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const applyForDoctorRoleController = async (req, res) => {
  try {
    console.log("-----🟢 inside applyForDoctorRoleController-------");

    const { userId } = req.currentPatient;

    const { qualification, specialization, experience, licenseNumber } =
      req.body;

    const existingApplication = await DoctorApplicationsModel.findOne({
      userId,
    });

    if (existingApplication) {
      return res.status(400).json({
        isSuccess: false,
        message:
          "You have already applied for doctor role. Please wait for admin review.",
      });
    }

    const application = await DoctorApplicationsModel.create({
      userId,
      qualification,
      specialization,
      experience,
      licenseNumber,
    });

    res.status(201).json({
      isSuccess: true,
      message: "Doctor role application submitted successfully",
      data: {
        applicationId: application._id,
        status: application.status,
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in applyForDoctorRoleController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const getAvailableSlotsController = async (req, res) => {
  try {
    console.log("-----🟢 inside getAvailableSlotsController-------");

    const { doctorId, date } = req.query;

    if (!doctorId || !date) {
      return res.status(400).json({
        isSuccess: false,
        message: "DoctorID and date are required",
      });
    }

    const doctor = await DoctorModel.findOne({
      userId: doctorId,
      isVerified: true,
    });

    if (!doctor) {
      return res.status(404).json({
        isSuccess: false,
        message: "Doctor not found or not verified",
      });
    }

    const availableSlots = await DoctorAvailabiltyModel.getBookableSlots(
      doctorId,
      date,
      AppointmentModel,
    );

    res.status(200).json({
      isSuccess: true,
      message: "Available slots retrieved",
      data: {
        doctorId,
        date,
        availableSlots,
        totalSlots: availableSlots.length,
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in getAvailableSlotsController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const bookAppointmentController = async (req, res) => {
  try {
    console.log("-----🟢 inside bookAppointmentController-------");

    const { userId } = req.currentPatient;
    const { conversationId, doctorId, date, timeSlot } = req.body;

    if (!conversationId || !doctorId || !date || !timeSlot) {
      return res.status(400).json({
        isSuccess: false,
        message:
          "All fields are required: conversationId, doctorId, date, timeSlot",
      });
    }

    const chatHistory = await ChatHistoryModel.findOne({
      conversationId,
      patientId: userId,
    });

    if (!chatHistory) {
      return res.status(404).json({
        isSuccess: false,
        message: "Conversation not found. Please complete chatbot first.",
      });
    }

    if (!chatHistory.summary || !chatHistory.summary.symptoms) {
      return res.status(400).json({
        isSuccess: false,
        message:
          "Conversation not completed. Please complete chat to get summary first.",
      });
    }

    const doctor = await DoctorModel.findOne({
      userId: doctorId,
      isVerified: true,
    });

    if (!doctor) {
      return res.status(404).json({
        isSuccess: false,
        message: "Doctor not found or not verified",
      });
    }

    const isAvailable = await AppointmentModel.isSlotAvailable(
      doctorId,
      date,
      timeSlot,
    );

    if (!isAvailable) {
      return res.status(409).json({
        isSuccess: false,
        message:
          "This time slot is already booked. Please choose another slot.",
      });
    }

    const urgencyLevel =
      chatHistory.summary.urgencyLevel === "emergency" ? "emergency" : "normal";

    const appointment = await AppointmentModel.create({
      patientId: userId,
      doctorId: doctorId,
      date: new Date(date),
      timeSlot: timeSlot,
      status: "pending_admin_approval",
      urgencyLevel: urgencyLevel,
      chatConversationId: conversationId,
      symptoms: chatHistory.summary.symptoms,
      aiSummary: formatAISummary(chatHistory.summary),
      originalBooking: {
        doctorId: doctorId,
        date: new Date(date),
        timeSlot: timeSlot,
      },
    });

    chatHistory.appointmentId = appointment._id;
    await chatHistory.save();

    const doctorUser =
      await UserModel.findById(doctorId).select("name email phone");

    res.status(201).json({
      isSuccess: true,
      message:
        urgencyLevel === "emergency"
          ? "Emergency appointment created! Waiting for admin approval."
          : "Appointment booked successfully! Waiting for admin approval.",
      data: {
        appointmentId: appointment._id,
        status: appointment.status,
        urgencyLevel: appointment.urgencyLevel,
        doctor: {
          name: doctorUser.name,
          specialization: doctor.specialization,
        },
        date: appointment.date,
        timeSlot: appointment.timeSlot,
        estimatedApprovalTime:
          urgencyLevel === "emergency"
            ? "Admin will review within 30 minutes"
            : "Admin will review within 24 hours",
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in bookAppointmentController--------");
    console.error(err);

    if (err.code === 11000) {
      return res.status(409).json({
        isSuccess: false,
        message: "You already have an appointment at this time",
      });
    }

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const getPatientAppointmentsController = async (req, res) => {
  try {
    console.log("-----🟢 inside getPatientAppointmentsController-------");

    const { userId } = req.currentPatient;
    const { status } = req.query;

    const query = { patientId: userId };
    if (status) {
      query.status = status;
    }

    const appointments = await AppointmentModel.find(query)
      .populate("doctorId", "name email phone profilePhoto")
      .sort({ date: -1, createdAt: -1 });

    const appointmentsWithDetails = await Promise.all(
      appointments.map(async (apt) => {
        const doctor = await DoctorModel.findOne({
          userId: apt.doctorId._id,
        }).select("specialization qualification experience consultationFee");

        return {
          appointmentId: apt._id,
          status: apt.status,
          urgencyLevel: apt.urgencyLevel,
          date: apt.date,
          timeSlot: apt.timeSlot,
          symptoms: apt.symptoms,
          doctor: {
            userId: apt.doctorId._id,
            name: apt.doctorId.name,
            email: apt.doctorId.email,
            phone: apt.doctorId.phone,
            profilePhoto: apt.doctorId.profilePhoto,
            specialization: doctor?.specialization,
            qualification: doctor?.qualification,
            consultationFee: doctor?.consultationFee,
          },
          createdAt: apt.createdAt,
          adminNotes: apt.adminNotes,
        };
      }),
    );

    res.status(200).json({
      isSuccess: true,
      message: "Appointments retrieved successfully",
      data: {
        count: appointmentsWithDetails.length,
        appointments: appointmentsWithDetails,
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in getPatientAppointmentsController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const getAppointmentDetailsController = async (req, res) => {
  try {
    console.log("-----🟢 inside getAppointmentDetailsController-------");

    const { userId } = req.currentPatient;
    const { appointmentId } = req.params;

    const appointment = await AppointmentModel.findOne({
      _id: appointmentId,
      patientId: userId,
    })
      .populate("doctorId", "name email phone profilePhoto")
      .populate("adminApprovedBy", "name");

    if (!appointment) {
      return res.status(404).json({
        isSuccess: false,
        message: "Appointment not found",
      });
    }

    const doctor = await DoctorModel.findOne({
      userId: appointment.doctorId._id,
    });

    const chatHistory = await ChatHistoryModel.findOne({
      conversationId: appointment.chatConversationId,
    }).select("messages summary");

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
          adminNotes: appointment.adminNotes,
          doctorNotes: appointment.doctorNotes,
          prescription: appointment.prescription,
          adminApprovedBy: appointment.adminApprovedBy?.name,
          adminApprovedAt: appointment.adminApprovedAt,
          createdAt: appointment.createdAt,
        },
        doctor: {
          name: appointment.doctorId.name,
          email: appointment.doctorId.email,
          phone: appointment.doctorId.phone,
          specialization: doctor?.specialization,
          qualification: doctor?.qualification,
          experience: doctor?.experience,
        },
        chatSummary: chatHistory?.summary,
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in getAppointmentDetailsController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const cancelAppointmentController = async (req, res) => {
  try {
    console.log("-----🟢 inside cancelAppointmentController-------");

    const { userId } = req.currentPatient;
    const { appointmentId } = req.params;

    const appointment = await AppointmentModel.findOne({
      _id: appointmentId,
      patientId: userId,
    });

    if (!appointment) {
      return res.status(404).json({
        isSuccess: false,
        message: "Appointment not found",
      });
    }

    if (!["pending_admin_approval", "confirmed"].includes(appointment.status)) {
      return res.status(400).json({
        isSuccess: false,
        message: `Cannot cancel appointment with status: ${appointment.status}`,
      });
    }

    await appointment.cancel("Cancelled by patient");

    res.status(200).json({
      isSuccess: true,
      message: "Appointment cancelled successfully",
    });
  } catch (err) {
    console.error("-----🔴 Error in cancelAppointmentController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const formatAISummary = (summary) => {
  return `
**Patient Symptoms Summary**

Main Symptoms:
${summary.symptoms.map((s) => `• ${s}`).join("\n")}

Duration: ${summary.duration || "Not specified"}
Severity: ${summary.severity || "N/A"}/10
Urgency Level: ${summary.urgencyLevel || "Normal"}

Recommended Specialist: ${summary.recommendedSpecialist || "General Physician"}

Detailed Summary:
${summary.detailedSummary || "No additional details available"}
    `.trim();
};

module.exports = {
  patientDashboardController,
  applyForDoctorRoleController,
  getAvailableSlotsController,
  bookAppointmentController,
  getPatientAppointmentsController,
  getAppointmentDetailsController,
  cancelAppointmentController,
};
