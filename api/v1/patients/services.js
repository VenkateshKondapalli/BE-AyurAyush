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
const { formatAISummary } = require("../../../utils/helpers");

const getPatientDashboard = async (userId) => {
  let patient = await PatientModel.findOne({ userId });

  if (!patient) {
    patient = await PatientModel.create({
      userId,
      bloodGroup: null,
      medicalHistory: [],
      allergies: [],
      emergencyContact: {},
    });
  }

  return {
    patientId: patient._id,
    userId: patient.userId,
    bloodGroup: patient.bloodGroup,
    medicalHistory: patient.medicalHistory,
    allergies: patient.allergies,
    emergencyContact: patient.emergencyContact,
    createdAt: patient.createdAt,
  };
};

const applyForDoctorRole = async (
  userId,
  { qualification, specialization, experience, licenseNumber },
) => {
  const existingApplication = await DoctorApplicationsModel.findOne({
    userId,
  });

  if (existingApplication) {
    const error = new Error(
      "You have already applied for doctor role. Please wait for admin review.",
    );
    error.statusCode = 400;
    throw error;
  }

  const application = await DoctorApplicationsModel.create({
    userId,
    qualification,
    specialization,
    experience,
    licenseNumber,
  });

  return {
    applicationId: application._id,
    status: application.status,
  };
};

const getAvailableSlots = async (doctorId, date) => {
  const doctor = await DoctorModel.findOne({
    userId: doctorId,
    isVerified: true,
  });

  if (!doctor) {
    const error = new Error("Doctor not found or not verified");
    error.statusCode = 404;
    throw error;
  }

  const availableSlots = await DoctorAvailabiltyModel.getBookableSlots(
    doctorId,
    date,
    AppointmentModel,
  );

  return {
    doctorId,
    date,
    availableSlots,
    totalSlots: availableSlots.length,
  };
};

const bookAppointment = async (
  userId,
  { conversationId, doctorId, date, timeSlot },
) => {
  const chatHistory = await ChatHistoryModel.findOne({
    conversationId,
    patientId: userId,
  });

  if (!chatHistory) {
    const error = new Error(
      "Conversation not found. Please complete chatbot first.",
    );
    error.statusCode = 404;
    throw error;
  }

  if (!chatHistory.summary || !chatHistory.summary.symptoms) {
    const error = new Error(
      "Conversation not completed. Please complete chat to get summary first.",
    );
    error.statusCode = 400;
    throw error;
  }

  const doctor = await DoctorModel.findOne({
    userId: doctorId,
    isVerified: true,
  });

  if (!doctor) {
    const error = new Error("Doctor not found or not verified");
    error.statusCode = 404;
    throw error;
  }

  const isAvailable = await AppointmentModel.isSlotAvailable(
    doctorId,
    date,
    timeSlot,
  );

  if (!isAvailable) {
    const error = new Error(
      "This time slot is already booked. Please choose another slot.",
    );
    error.statusCode = 409;
    throw error;
  }

  const urgencyLevel =
    chatHistory.summary.urgencyLevel === "emergency" ? "emergency" : "normal";

  const appointment = await AppointmentModel.create({
    patientId: userId,
    doctorId,
    date: new Date(date),
    timeSlot,
    status: "pending_admin_approval",
    urgencyLevel,
    chatConversationId: conversationId,
    symptoms: chatHistory.summary.symptoms,
    aiSummary: formatAISummary(chatHistory.summary),
    originalBooking: {
      doctorId,
      date: new Date(date),
      timeSlot,
    },
  });

  chatHistory.appointmentId = appointment._id;
  await chatHistory.save();

  const doctorUser =
    await UserModel.findById(doctorId).select("name email phone");

  return {
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
  };
};

const getPatientAppointments = async (userId, status) => {
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

  return {
    count: appointmentsWithDetails.length,
    appointments: appointmentsWithDetails,
  };
};

const getAppointmentDetails = async (userId, appointmentId) => {
  const appointment = await AppointmentModel.findOne({
    _id: appointmentId,
    patientId: userId,
  })
    .populate("doctorId", "name email phone profilePhoto")
    .populate("adminApprovedBy", "name");

  if (!appointment) {
    const error = new Error("Appointment not found");
    error.statusCode = 404;
    throw error;
  }

  const doctor = await DoctorModel.findOne({
    userId: appointment.doctorId._id,
  });

  const chatHistory = await ChatHistoryModel.findOne({
    conversationId: appointment.chatConversationId,
  }).select("messages summary");

  return {
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
  };
};

const cancelAppointment = async (userId, appointmentId) => {
  const appointment = await AppointmentModel.findOne({
    _id: appointmentId,
    patientId: userId,
  });

  if (!appointment) {
    const error = new Error("Appointment not found");
    error.statusCode = 404;
    throw error;
  }

  if (!["pending_admin_approval", "confirmed"].includes(appointment.status)) {
    const error = new Error(
      `Cannot cancel appointment with status: ${appointment.status}`,
    );
    error.statusCode = 400;
    throw error;
  }

  await appointment.cancel("Cancelled by patient");
};

const getVerifiedDoctors = async (specialization) => {
  const doctorQuery = { isVerified: true };
  if (specialization) {
    const escaped = specialization.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    doctorQuery.specialization = { $regex: new RegExp(`^${escaped}$`, "i") };
  }

  const doctors = await DoctorModel.find(doctorQuery);
  const doctorUserIds = doctors.map((d) => d.userId);

  const users = await UserModel.find({
    _id: { $in: doctorUserIds },
    isActive: true,
  }).select("name email phone gender profilePhoto");

  return doctors
    .map((doc) => {
      const user = users.find(
        (u) => u._id.toString() === doc.userId.toString(),
      );
      if (!user) return null;
      return {
        doctorId: doc.userId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        gender: user.gender,
        profilePhoto: user.profilePhoto,
        specialization: doc.specialization,
        qualification: doc.qualification,
        experience: doc.experience,
        consultationFee: doc.consultationFee,
      };
    })
    .filter(Boolean);
};

module.exports = {
  getPatientDashboard,
  applyForDoctorRole,
  getAvailableSlots,
  bookAppointment,
  getPatientAppointments,
  getAppointmentDetails,
  cancelAppointment,
  getVerifiedDoctors,
};
