const { AppointmentModel } = require("../../../models/appointmentSchema");
const { ChatHistoryModel } = require("../../../models/chatHistorySchema");
const {
  DoctorApplicationsModel,
} = require("../../../models/doctorApplicationSchema");
const { DoctorModel } = require("../../../models/doctorSchema");
const { UserModel, ROLE_OPTIONS } = require("../../../models/userSchema");

const adminDashboardController = async (req, res) => {
  try {
    console.log("-----🟢 inside adminDashboardController-------");

    const totalUsers = await UserModel.countDocuments();
    const totalDoctors = await UserModel.countDocuments({
      roles: "doctor",
    });
    const totalPatients = await UserModel.countDocuments({
      roles: "patient",
    });

    res.status(200).json({
      isSuccess: true,
      message: "Admin dashboard loaded successfully",
      data: {
        stats: {
          totalUsers,
          totalDoctors,
          totalPatients,
        },
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in adminDashboardController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const reviewDoctorApplicationsController = async (req, res) => {
  try {
    console.log("-----🟢 inside reviewDoctorApplicationsController-------");

    const applications = await DoctorApplicationsModel.find({
      status: "pending",
    }).populate("userId", "email");

    res.status(200).json({
      isSuccess: true,
      message: "Pending doctor applications fetched",
      data: {
        applications,
      },
    });
  } catch (err) {
    console.error(
      "-----🔴 Error in reviewDoctorApplicationsController--------",
    );

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const approveDoctorApplicationController = async (req, res) => {
  try {
    console.log("-----🟢 inside approveDoctorApplicationController-------");

    const { applicationId } = req.params;

    const application = await DoctorApplicationsModel.findById(applicationId);

    if (!application) {
      return res.status(404).json({
        isSuccess: false,
        message: "Doctor application not found",
      });
    }

    if (application.status !== "pending") {
      return res.status(400).json({
        isSuccess: false,
        message: "Application already processed",
      });
    }

    application.status = "approved";
    application.reviewedBy = req.currentAdmin.userId;
    await application.save();

    await UserModel.findByIdAndUpdate(application.userId, {
      $addToSet: { roles: ROLE_OPTIONS.DOCTOR },
    });

    // create doctor profile
    await DoctorModel.create({
      userId: application.userId,
      specialization: application.specialization,
      experience: application.experience,
      qualification: application.qualification,
      isVerified: true,
    });

    res.status(200).json({
      isSuccess: true,
      message: "Doctor application approved successfully",
    });
  } catch (err) {
    console.error(
      "-----🔴 Error in approveDoctorApplicationController--------",
      err.message,
    );

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const rejectDoctorApplicationController = async (req, res) => {
  try {
    console.log("-----🟢 inside rejectDoctorApplicationController-------");

    const { applicationId } = req.params;

    const application = await DoctorApplicationModel.findById(applicationId);

    if (!application) {
      return res.status(404).json({
        isSuccess: false,
        message: "Doctor application not found",
      });
    }

    application.status = "rejected";
    application.reviewedBy = req.currentAdmin.userId;
    await application.save();

    res.status(200).json({
      isSuccess: true,
      message: "Doctor application rejected",
    });
  } catch (err) {
    console.error("-----🔴 Error in rejectDoctorApplicationController--------");

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const getpendingDoctorApplicationsController = async (req, res) => {
  try {
    console.log("-----🟢 inside getpendingDoctorApplicationsController-------");
    const appointments = await AppointmentModel.find({
      status: "pending_admin_approval",
      urgencyLevel: "normal",
    })
      .populate("patientId", "name email phone gender dob")
      .populate("doctorId", "name email phone")
      .sort({ createdAt: 1 });

    const appointmentsWithDetails = await Promise.all(
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

    res.status(200).json({
      isSuccess: true,
      message: "Pending appointments retrieved",
      data: {
        queueType: "normal",
        count: appointmentsWithDetails.length,
        appointments: appointmentsWithDetails,
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in getPendingAppointmentsController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const getEmergencyAppointmentsController = async (req, res) => {
  try {
    console.log("-----🟢 inside getEmergencyAppointmentsController-------");
    const appointments = await AppointmentModel.find({
      status: "pending_admin_approval",
      urgencyLevel: "emergency",
    })
      .populate("patientId", "name email phone gender dob")
      .populate("doctorId", "name email phone")
      .sort({ createdAt: 1 });
    const appointmentsWithDetails = await Promise.all(
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

    res.status(200).json({
      isSuccess: true,
      message: "Emergency appointments retrieved",
      data: {
        queueType: "emergency",
        count: appointmentsWithDetails.length,
        appointments: appointmentsWithDetails,
        alert:
          appointmentsWithDetails.length > 0
            ? "⚠️ Emergency appointments require immediate review!"
            : null,
      },
    });
  } catch (err) {
    console.error(
      "-----🔴 Error in getEmergencyAppointmentsController--------",
    );
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const approveAppointmentController = async (req, res) => {
  try {
    console.log("-----🟢 inside approveAppointmentController-------");

    const { appointmentId } = req.params;
    const { userId } = req.currentAdmin;
    const { edits, adminNotes } = req.body;

    const appointment = await appointmentModel.findById(appointmentId);

    if (!appointment) {
      return res.status(404).json({
        isSuccess: false,
        message: "Appointment not found",
      });
    }

    if (appointment.status !== "pending_admin_approval") {
      return res.status(400).json({
        isSuccess: false,
        message: `Appointment already ${appointment.status}`,
      });
    }

    if (edits) {
      if (edits.doctorId) {
        const doctor = await DoctorModel.findOne({
          userId: edits.doctorId,
          isVerified: true,
        });
        if (!doctor) {
          return res.status(400).json({
            isSuccess: false,
            message: "Selected doctor not found or not verified",
          });
        }
      }

      if (edits.date || edits.timeSlot || edits.doctorId) {
        const checkDoctorId = edits.doctorId || appointment.doctorId;
        const checkDate = edits.date || appointment.date;
        const checkTimeSlot = edits.timeSlot || appointment.timeSlot;

        const isAvailable = await appointmentModel.isSlotAvailable(
          checkDoctorId,
          checkDate,
          checkTimeSlot,
        );

        if (!isAvailable) {
          return res.status(409).json({
            isSuccess: false,
            message:
              "The edited time slot is not available. Please choose another slot.",
          });
        }
      }
    }

    if (adminNotes) {
      appointment.adminNotes = adminNotes;
    }

    await appointment.approveByAdmin(userId, edits);

    const updatedAppointment = await appointmentModel
      .findById(appointmentId)
      .populate("patientId", "name email")
      .populate("doctorId", "name");

    res.status(200).json({
      isSuccess: true,
      message: "Appointment approved successfully",
      data: {
        appointmentId: updatedAppointment._id,
        status: updatedAppointment.status,
        patient: updatedAppointment.patientId.name,
        doctor: updatedAppointment.doctorId.name,
        date: updatedAppointment.date,
        timeSlot: updatedAppointment.timeSlot,
        wasEdited: edits ? true : false,
        editedFields: updatedAppointment.adminEditedFields,
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in approveAppointmentController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const rejectAppointmentController = async (req, res) => {
  try {
    console.log("-----🟢 inside rejectAppointmentController-------");

    const { appointmentId } = req.params;
    const { userId } = req.currentAdmin;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        isSuccess: false,
        message: "Rejection reason is required",
      });
    }

    const appointment = await appointmentModel.findById(appointmentId);

    if (!appointment) {
      return res.status(404).json({
        isSuccess: false,
        message: "Appointment not found",
      });
    }

    if (appointment.status !== "pending_admin_approval") {
      return res.status(400).json({
        isSuccess: false,
        message: `Appointment already ${appointment.status}`,
      });
    }

    await appointment.rejectByAdmin(userId, reason);

    res.status(200).json({
      isSuccess: true,
      message: "Appointment rejected",
      data: {
        appointmentId: appointment._id,
        status: appointment.status,
        reason: reason,
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in rejectAppointmentController--------");
    console.error(err);

    res.status(500).json({
      isSuccess: false,
      message: "Internal Server Error",
    });
  }
};

const setDoctorAvailabilityController = async (req, res) => {
  try {
    console.log("-----🟢 inside setDoctorAvailabilityController-------");

    const { doctorId } = req.params;
    const { userId } = req.currentAdmin;
    const { availableDays, timeSlots, unavailableDates } = req.body;

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

    let availability = await doctorAvailabiltyModel.findOne({ doctorId });

    if (availability) {
      availability.availableDays = availableDays || availability.availableDays;
      availability.timeSlots = timeSlots || availability.timeSlots;
      availability.unavailableDates =
        unavailableDates || availability.unavailableDates;
      availability.lastUpdatedBy = userId;
      await availability.save();
    } else {
      availability = await doctorAvailabiltyModel.create({
        doctorId,
        availableDays,
        timeSlots,
        unavailableDates: unavailableDates || [],
        setByAdmin: userId,
        lastUpdatedBy: userId,
      });
    }

    res.status(200).json({
      isSuccess: true,
      message: "Doctor availability updated successfully",
      data: {
        doctorId,
        availableDays: availability.availableDays,
        timeSlots: availability.timeSlots,
      },
    });
  } catch (err) {
    console.error("-----🔴 Error in setDoctorAvailabilityController--------");
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

const calculateWaitingTime = (createdAt) => {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 60) {
    return `${diffMins} minutes`;
  } else if (diffMins < 1440) {
    return `${Math.floor(diffMins / 60)} hours`;
  } else {
    return `${Math.floor(diffMins / 1440)} days`;
  }
};

module.exports = {
  adminDashboardController,
  reviewDoctorApplicationsController,
  approveDoctorApplicationController,
  rejectDoctorApplicationController,
  getpendingDoctorApplicationsController,
  getEmergencyAppointmentsController,
  approveAppointmentController,
  rejectAppointmentController,
  setDoctorAvailabilityController,
};
