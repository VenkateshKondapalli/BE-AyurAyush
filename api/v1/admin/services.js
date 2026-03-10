const { AppointmentModel } = require("../../../models/appointmentSchema");
const { ChatHistoryModel } = require("../../../models/chatHistorySchema");
const {
  DoctorApplicationsModel,
} = require("../../../models/doctorApplicationSchema");
const { DoctorModel } = require("../../../models/doctorSchema");
const {
  DoctorAvailabiltyModel,
} = require("../../../models/doctorAvailabilitySchema");
const { UserModel, ROLE_OPTIONS } = require("../../../models/userSchema");
const { PatientModel } = require("../../../models/patientSchema");
const {
  calculateAge,
  calculateWaitingTime,
} = require("../../../utils/helpers");

const getDashboardStats = async () => {
  const [totalUsers, totalDoctors, totalPatients] = await Promise.all([
    UserModel.countDocuments(),
    UserModel.countDocuments({ roles: "doctor" }),
    UserModel.countDocuments({ roles: "patient" }),
  ]);
  return { totalUsers, totalDoctors, totalPatients };
};

const getPendingDoctorApplications = async () => {
  return DoctorApplicationsModel.find({ status: "pending" }).populate(
    "userId",
    "email",
  );
};

const approveDoctorApplication = async (applicationId, adminUserId) => {
  const application = await DoctorApplicationsModel.findById(applicationId);

  if (!application) {
    const err = new Error("Doctor application not found");
    err.statusCode = 404;
    throw err;
  }

  if (application.status !== "pending") {
    const err = new Error("Application already processed");
    err.statusCode = 400;
    throw err;
  }

  application.status = "approved";
  application.reviewedBy = adminUserId;
  application.reviewedAt = new Date();
  await application.save();

  await UserModel.findByIdAndUpdate(application.userId, {
    $addToSet: { roles: ROLE_OPTIONS.DOCTOR },
  });

  await DoctorModel.create({
    userId: application.userId,
    specialization: application.specialization,
    experience: application.experience,
    qualification: application.qualification,
    licenseNumber: application.licenseNumber,
    isVerified: true,
    verifiedAt: new Date(),
  });
};

const rejectDoctorApplication = async (applicationId, adminUserId) => {
  const application = await DoctorApplicationsModel.findById(applicationId);

  if (!application) {
    const err = new Error("Doctor application not found");
    err.statusCode = 404;
    throw err;
  }

  application.status = "rejected";
  application.reviewedBy = adminUserId;
  application.reviewedAt = new Date();
  await application.save();
};

const getPendingNormalAppointments = async () => {
  const appointments = await AppointmentModel.find({
    status: "pending_admin_approval",
    urgencyLevel: "normal",
  })
    .populate("patientId", "name email phone gender dob")
    .populate("doctorId", "name email phone")
    .sort({ createdAt: 1 });

  return Promise.all(
    appointments.map(async (apt) => {
      const doctor = await DoctorModel.findOne({
        userId: apt.doctorId._id,
      }).select("specialization qualification experience");

      return {
        appointmentId: apt._id,
        patient: {
          id: apt.patientId._id,
          name: apt.patientId.name,
          email: apt.patientId.email,
          phone: apt.patientId.phone,
          gender: apt.patientId.gender,
          age: calculateAge(apt.patientId.dob),
        },
        doctor: {
          id: apt.doctorId._id,
          name: apt.doctorId.name,
          specialization: doctor?.specialization,
        },
        appointmentDetails: {
          date: apt.date,
          timeSlot: apt.timeSlot,
          symptoms: apt.symptoms,
          aiSummary: apt.aiSummary,
          urgencyLevel: apt.urgencyLevel,
        },
        createdAt: apt.createdAt,
        waitingTime: calculateWaitingTime(apt.createdAt),
      };
    }),
  );
};

const getEmergencyAppointments = async () => {
  const appointments = await AppointmentModel.find({
    status: "pending_admin_approval",
    urgencyLevel: "emergency",
  })
    .populate("patientId", "name email phone gender dob")
    .populate("doctorId", "name email phone")
    .sort({ createdAt: 1 });

  return Promise.all(
    appointments.map(async (apt) => {
      const doctor = await DoctorModel.findOne({
        userId: apt.doctorId._id,
      }).select("specialization qualification experience");

      const chatHistory = await ChatHistoryModel.findOne({
        conversationId: apt.chatConversationId,
      }).select("messages");

      return {
        appointmentId: apt._id,
        patient: {
          id: apt.patientId._id,
          name: apt.patientId.name,
          email: apt.patientId.email,
          phone: apt.patientId.phone,
          gender: apt.patientId.gender,
          age: calculateAge(apt.patientId.dob),
        },
        doctor: {
          id: apt.doctorId._id,
          name: apt.doctorId.name,
          specialization: doctor?.specialization,
        },
        appointmentDetails: {
          date: apt.date,
          timeSlot: apt.timeSlot,
          symptoms: apt.symptoms,
          aiSummary: apt.aiSummary,
          urgencyLevel: apt.urgencyLevel,
          fullChatHistory: chatHistory?.messages,
        },
        createdAt: apt.createdAt,
        waitingTime: calculateWaitingTime(apt.createdAt),
        priority: "🚨 URGENT - EMERGENCY",
      };
    }),
  );
};

const approveAppointment = async (
  appointmentId,
  adminUserId,
  edits,
  adminNotes,
) => {
  const appointment = await AppointmentModel.findById(appointmentId);

  if (!appointment) {
    const err = new Error("Appointment not found");
    err.statusCode = 404;
    throw err;
  }

  if (appointment.status !== "pending_admin_approval") {
    const err = new Error(`Appointment already ${appointment.status}`);
    err.statusCode = 400;
    throw err;
  }

  if (edits) {
    if (edits.doctorId) {
      const doctor = await DoctorModel.findOne({
        userId: edits.doctorId,
        isVerified: true,
      });
      if (!doctor) {
        const err = new Error("Selected doctor not found or not verified");
        err.statusCode = 400;
        throw err;
      }
    }

    if (edits.date || edits.timeSlot || edits.doctorId) {
      const checkDoctorId = edits.doctorId || appointment.doctorId;
      const checkDate = edits.date || appointment.date;
      const checkTimeSlot = edits.timeSlot || appointment.timeSlot;

      const isAvailable = await AppointmentModel.isSlotAvailable(
        checkDoctorId,
        checkDate,
        checkTimeSlot,
      );

      if (!isAvailable) {
        const err = new Error(
          "The edited time slot is not available. Please choose another slot.",
        );
        err.statusCode = 409;
        throw err;
      }
    }
  }

  if (adminNotes) {
    appointment.adminNotes = adminNotes;
  }

  await appointment.approveByAdmin(adminUserId, edits);

  const updatedAppointment = await AppointmentModel.findById(appointmentId)
    .populate("patientId", "name email")
    .populate("doctorId", "name");

  return {
    appointmentId: updatedAppointment._id,
    status: updatedAppointment.status,
    patient: updatedAppointment.patientId.name,
    doctor: updatedAppointment.doctorId.name,
    date: updatedAppointment.date,
    timeSlot: updatedAppointment.timeSlot,
    wasEdited: !!edits,
    editedFields: updatedAppointment.adminEditedFields,
  };
};

const rejectAppointment = async (appointmentId, adminUserId, reason) => {
  const appointment = await AppointmentModel.findById(appointmentId);

  if (!appointment) {
    const err = new Error("Appointment not found");
    err.statusCode = 404;
    throw err;
  }

  if (appointment.status !== "pending_admin_approval") {
    const err = new Error(`Appointment already ${appointment.status}`);
    err.statusCode = 400;
    throw err;
  }

  await appointment.rejectByAdmin(adminUserId, reason);

  return { appointmentId: appointment._id, status: appointment.status, reason };
};

const setDoctorAvailability = async (
  doctorId,
  adminUserId,
  { availableDays, timeSlots, unavailableDates },
) => {
  const doctor = await DoctorModel.findOne({
    userId: doctorId,
    isVerified: true,
  });

  if (!doctor) {
    const err = new Error("Doctor not found or not verified");
    err.statusCode = 404;
    throw err;
  }

  let availability = await DoctorAvailabiltyModel.findOne({ doctorId });

  if (availability) {
    availability.availableDays = availableDays || availability.availableDays;
    availability.timeSlots = timeSlots || availability.timeSlots;
    availability.unavailableDates =
      unavailableDates || availability.unavailableDates;
    availability.lastUpdatedBy = adminUserId;
    await availability.save();
  } else {
    availability = await DoctorAvailabiltyModel.create({
      doctorId,
      availableDays,
      timeSlots,
      unavailableDates: unavailableDates || [],
      setByAdmin: adminUserId,
      lastUpdatedBy: adminUserId,
    });
  }

  return {
    doctorId,
    availableDays: availability.availableDays,
    timeSlots: availability.timeSlots,
  };
};

const offlineBookAppointment = async (adminId, bookingData) => {
  const {
    patientEmail,
    doctorId,
    date,
    timeSlot,
    symptoms,
    urgencyLevel,
    adminNotes,
  } = bookingData;

  const patientUser = await UserModel.findOne({ email: patientEmail });
  if (!patientUser) {
    const err = new Error("Patient not found with this email");
    err.statusCode = 404;
    throw err;
  }

  let patient = await PatientModel.findOne({ userId: patientUser._id });
  if (!patient) {
    patient = await PatientModel.create({
      userId: patientUser._id,
      bloodGroup: null,
      medicalHistory: [],
      allergies: [],
      emergencyContact: {},
    });
  }

  const doctor = await DoctorModel.findOne({
    userId: doctorId,
    isVerified: true,
  });

  if (!doctor) {
    const err = new Error("Doctor not found or not verified");
    err.statusCode = 404;
    throw err;
  }

  const isAvailable = await AppointmentModel.isSlotAvailable(
    doctorId,
    date,
    timeSlot,
  );

  if (!isAvailable) {
    const err = new Error("This time slot is already booked");
    err.statusCode = 409;
    throw err;
  }

  const appointment = await AppointmentModel.create({
    patientId: patientUser._id,
    doctorId,
    date: new Date(date),
    timeSlot,
    status: "confirmed",
    urgencyLevel: urgencyLevel || "normal",
    symptoms: symptoms || [],
    aiSummary: symptoms
      ? `**Walk-in Patient**\n\nSymptoms: ${symptoms.join(", ")}\n\nBooked by admin (offline).`
      : "Walk-in patient. Booked by admin (offline).",
    adminApprovedBy: adminId,
    adminApprovedAt: new Date(),
    adminNotes: adminNotes || "Offline booking by admin",
    originalBooking: { doctorId, date: new Date(date), timeSlot },
  });

  const doctorUser = await UserModel.findById(doctorId).select("name");

  return {
    appointmentId: appointment._id,
    status: appointment.status,
    patient: patientUser.name,
    doctor: doctorUser.name,
    specialization: doctor.specialization,
    date: appointment.date,
    timeSlot: appointment.timeSlot,
  };
};

module.exports = {
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
};
