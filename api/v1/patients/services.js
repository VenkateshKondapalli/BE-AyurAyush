const { AppointmentModel } = require("../../../models/appointmentSchema");
const {
    DoctorApplicationsModel,
} = require("../../../models/doctorApplicationSchema");
const {
    DoctorAvailabiltyModel,
} = require("../../../models/doctorAvailabilitySchema");
const { DoctorModel } = require("../../../models/doctorSchema");
const { PatientModel } = require("../../../models/patientSchema");
const { UserModel } = require("../../../models/userSchema");
const mongoose = require("mongoose");
const { QueueTokenModel } = require("../../../models/queueTokenSchema");
const {
    TherapyResourceModel,
} = require("../../../models/therapyResourceSchema");
const {
    formatAISummary,
    parsePagination,
    generateTokenNumber,
    getISTDateKey,
    getISTDayBounds,
} = require("../../../utils/helpers");
const {
    notifyAppointmentBooked,
    notifyAppointmentCancelled,
} = require("../../../utils/appointmentNotifications");
const { ChatHistoryModel } = require("../../../models/chatHistorySchema");
const { getTreatmentSuggestions } = require("../treatments/services");
const { createPaymentOrder } = require("../payments/services");

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

    const { start: todayStartIST } = getISTDayBounds();

    const [
        totalAppointments,
        upcomingAppointments,
        completedAppointments,
        cancelledAppointments,
        recentAppointmentsDocs,
    ] = await Promise.all([
        AppointmentModel.countDocuments({ patientId: userId }),
        AppointmentModel.countDocuments({
            patientId: userId,
            status: { $in: ["pending_admin_approval", "confirmed"] },
            date: { $gte: todayStartIST },
        }),
        AppointmentModel.countDocuments({
            patientId: userId,
            status: "completed",
        }),
        AppointmentModel.countDocuments({
            patientId: userId,
            status: { $in: ["cancelled", "rejected"] },
        }),
        AppointmentModel.find({ patientId: userId })
            .populate("doctorId", "name email phone profilePhoto")
            .sort({ date: -1, createdAt: -1 })
            .limit(5),
    ]);

    const doctorUserIds = recentAppointmentsDocs
        .map((apt) => apt.doctorId?._id)
        .filter(Boolean);

    const doctorProfiles = await DoctorModel.find({
        userId: { $in: doctorUserIds },
    }).select("userId specialization qualification consultationFee");

    const doctorMap = new Map(
        doctorProfiles.map((d) => [d.userId.toString(), d]),
    );

    const recentAppointments = recentAppointmentsDocs.map((apt) => {
        const doctorProfile = apt.doctorId
            ? doctorMap.get(apt.doctorId._id.toString())
            : null;

        return {
            appointmentId: apt._id,
            status: apt.status,
            urgencyLevel: apt.urgencyLevel,
            date: apt.date,
            timeSlot: apt.timeSlot,
            symptoms: apt.symptoms,
            tokenNumber: apt.tokenNumber,
            queueType: apt.queueType,
            queueStatus:
                apt.queueStatus ||
                (apt.status === "confirmed" ? "waiting" : null),
            queueCallCount: apt.queueCallCount || 0,
            queueNotificationMessage: apt.queueNotificationMessage || "",
            lastCalledAt: apt.lastCalledAt,
            doctor: {
                userId: apt.doctorId?._id,
                name: apt.doctorId?.name,
                email: apt.doctorId?.email,
                phone: apt.doctorId?.phone,
                profilePhoto: apt.doctorId?.profilePhoto,
                specialization: doctorProfile?.specialization,
                qualification: doctorProfile?.qualification,
                consultationFee: doctorProfile?.consultationFee,
            },
            createdAt: apt.createdAt,
            adminNotes: apt.adminNotes,
            cancelledBy: apt.cancelledBy || null,
        };
    });

    return {
        patientId: patient._id,
        userId: patient.userId,
        mrn: patient.mrn,
        bloodGroup: patient.bloodGroup,
        medicalHistory: patient.medicalHistory,
        allergies: patient.allergies,
        emergencyContact: patient.emergencyContact,
        stats: {
            totalAppointments,
            upcomingAppointments,
            completedAppointments,
            cancelledAppointments,
        },
        recentAppointments,
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
    {
        conversationId,
        doctorId,
        date,
        timeSlot,
        queueType = "normal",
        treatmentCode = null,
        therapistId = null,
        roomId = null,
        languagePreference = "english",
    },
) => {
    const chatHistory = await ChatHistoryModel.findOne({
        conversationId,
        patientId: userId,
    });

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
        chatHistory.summary.urgencyLevel === "emergency"
            ? "emergency"
            : "normal";

    // Format queueDate as "YYYY-MM-DD" string (matches QueueTokenModel key)
    const appointmentDate = new Date(date);
    const queueDate = getISTDateKey(appointmentDate);

    // Use a MongoDB transaction to atomically:
    // 1. Increment the queue token counter
    // 2. Create the appointment
    // 3. (For Panchakarma) Reserve therapist + room slots
    const session = await mongoose.startSession();
    let appointment;

    try {
        await session.withTransaction(async () => {
            // Atomic token sequence increment (upsert counter doc)
            const tokenDoc = await QueueTokenModel.findOneAndUpdate(
                { queueDate, doctorId, queueType },
                { $inc: { lastSequence: 1 } },
                { upsert: true, new: true, session },
            );
            const tokenSequence = tokenDoc.lastSequence;
            const tokenNumber = generateTokenNumber(
                queueDate,
                doctorId,
                tokenSequence,
            );

            appointment = await AppointmentModel.create(
                [
                    {
                        patientId: userId,
                        doctorId,
                        date: appointmentDate,
                        timeSlot,
                        status: "pending_payment",
                        urgencyLevel,
                        chatConversationId: conversationId,
                        symptoms: chatHistory.summary.symptoms,
                        aiSummary: formatAISummary(chatHistory.summary),
                        queueType,
                        tokenNumber,
                        queueDate,
                        tokenSequence,
                        treatmentCode: treatmentCode || null,
                        therapistId: therapistId || null,
                        roomId: roomId || null,
                        languagePreference,
                        originalBooking: {
                            doctorId,
                            date: appointmentDate,
                            timeSlot,
                        },
                    },
                ],
                { session },
            );
            appointment = appointment[0]; // create() with session returns array

            // For Panchakarma: reserve therapist and room slots
            if (queueType === "panchakarma" && therapistId && roomId) {
                const slotDate = new Date(getISTDateKey(appointmentDate));

                const [existingTherapist, existingRoom] = await Promise.all([
                    TherapyResourceModel.findOne(
                        { date: slotDate, therapistId, slot: timeSlot },
                        null,
                        { session },
                    ),
                    TherapyResourceModel.findOne(
                        { date: slotDate, roomId, slot: timeSlot },
                        null,
                        { session },
                    ),
                ]);

                if (existingTherapist?.status === "booked") {
                    throw Object.assign(
                        new Error(
                            "Selected therapist is already booked for this slot",
                        ),
                        { statusCode: 409 },
                    );
                }
                if (existingRoom?.status === "booked") {
                    throw Object.assign(
                        new Error(
                            "Selected room is already booked for this slot",
                        ),
                        { statusCode: 409 },
                    );
                }

                await Promise.all([
                    TherapyResourceModel.findOneAndUpdate(
                        { date: slotDate, therapistId, slot: timeSlot },
                        {
                            $set: {
                                status: "booked",
                                appointmentId: appointment._id,
                                roomId: null,
                            },
                        },
                        { upsert: true, session },
                    ),
                    TherapyResourceModel.findOneAndUpdate(
                        { date: slotDate, roomId, slot: timeSlot },
                        {
                            $set: {
                                status: "booked",
                                appointmentId: appointment._id,
                                therapistId: null,
                            },
                        },
                        { upsert: true, session },
                    ),
                ]);
            }

            chatHistory.appointmentId = appointment._id;
            await chatHistory.save({ session });
        });
    } finally {
        session.endSession();
    }

    const [doctorUser, patientUser] = await Promise.all([
        UserModel.findById(doctorId).select("name email phone"),
        UserModel.findById(userId).select("email"),
    ]);

    // Create Razorpay payment order immediately after booking
    const paymentOrder = await createPaymentOrder(userId, appointment._id);

    // Fire-and-forget email notification
    notifyAppointmentBooked(patientUser.email, {
        patientName: patientUser.name,
        doctorName: doctorUser.name,
        date: appointment.date,
        timeSlot: appointment.timeSlot,
        urgencyLevel,
    });

    return {
        appointmentId: appointment._id,
        status: appointment.status,
        urgencyLevel: appointment.urgencyLevel,
        queueType: appointment.queueType,
        tokenNumber: appointment.tokenNumber,
        queueDate: appointment.queueDate,
        doctor: {
            name: doctorUser.name,
            specialization: doctor.specialization,
        },
        date: appointment.date,
        timeSlot: appointment.timeSlot,
        paymentOrder,
        estimatedApprovalTime:
            urgencyLevel === "emergency"
                ? "Admin will review within 30 minutes after payment"
                : "Admin will review within 24 hours after payment",
    };
};

const getPatientAppointments = async (userId, status, query = {}) => {
    const { page, limit, skip } = parsePagination(query);
    const filter = { patientId: userId };

    if (status) {
        if (status === "upcoming") {
            const { start: todayStartIST } = getISTDayBounds();
            filter.status = { $in: ["pending_admin_approval", "confirmed"] };
            filter.date = { $gte: todayStartIST };
        } else if (status === "cancelled") {
            filter.status = { $in: ["cancelled", "rejected"] };
        } else {
            filter.status = status;
        }
    }

    // Default sort: desc for completed/cancelled/all, asc for upcoming
    const defaultSort = (!status || status === "completed" || status === "cancelled") ? "desc" : "asc";
    const sortOrder =
        String(query.sort || defaultSort).toLowerCase() === "desc" ? -1 : 1;

    const [appointments, totalCount] = await Promise.all([
        AppointmentModel.find(filter)
            .populate("doctorId", "name email phone profilePhoto")
            .sort({ date: sortOrder, createdAt: sortOrder })
            .skip(skip)
            .limit(limit),
        AppointmentModel.countDocuments(filter),
    ]);

    // Batch fetch all doctor profiles in one query instead of N+1
    const doctorUserIds = appointments.map((apt) => apt.doctorId._id);
    const doctorProfiles = await DoctorModel.find({
        userId: { $in: doctorUserIds },
    }).select("userId specialization qualification experience consultationFee");
    const doctorMap = new Map(
        doctorProfiles.map((d) => [d.userId.toString(), d]),
    );

    const activeQueueStatuses = ["waiting", "called", "in_consultation"];

    const getEffectiveTokenSequence = (apt) => {
        if (Number.isFinite(Number(apt.tokenSequence))) {
            return Number(apt.tokenSequence);
        }
        if (apt.tokenNumber) {
            const lastPart = String(apt.tokenNumber).split("-").pop();
            const parsed = Number(lastPart);
            if (Number.isFinite(parsed)) return parsed;
        }
        return null;
    };

    const appointmentsWithDetails = await Promise.all(
        appointments.map(async (apt) => {
            const doctor = doctorMap.get(apt.doctorId._id.toString());

            const effectiveTokenSequence = getEffectiveTokenSequence(apt);

            let queueAheadCount = null;
            if (apt.status === "confirmed" && effectiveTokenSequence) {
                queueAheadCount = await AppointmentModel.countDocuments({
                    doctorId: apt.doctorId,
                    queueDate: apt.queueDate,
                    queueType: apt.queueType,
                    status: "confirmed",
                    tokenSequence: { $lt: effectiveTokenSequence },
                    $or: [
                        { queueStatus: { $in: activeQueueStatuses } },
                        { queueStatus: null },
                        { queueStatus: { $exists: false } },
                    ],
                });
            }

            return {
                appointmentId: apt._id,
                status: apt.status,
                queueStatus:
                    apt.queueStatus ||
                    (apt.status === "confirmed" ? "waiting" : null),
                queueCallCount: apt.queueCallCount,
                lastCalledAt: apt.lastCalledAt,
                queueNotificationMessage: apt.queueNotificationMessage,
                queueType: apt.queueType,
                queueDate: apt.queueDate,
                tokenNumber: apt.tokenNumber,
                tokenSequence: effectiveTokenSequence,
                queueAheadCount,
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
                cancelledBy: apt.cancelledBy || null,
            };
        }),
    );

    return {
        count: appointmentsWithDetails.length,
        totalCount,
        page,
        totalPages: Math.ceil(totalCount / limit),
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

    const activeQueueStatuses = ["waiting", "called", "in_consultation"];
    const effectiveTokenSequence = Number.isFinite(
        Number(appointment.tokenSequence),
    )
        ? Number(appointment.tokenSequence)
        : appointment.tokenNumber
          ? Number(String(appointment.tokenNumber).split("-").pop())
          : null;

    let queueAheadCount = null;
    if (appointment.status === "confirmed" && effectiveTokenSequence) {
        queueAheadCount = await AppointmentModel.countDocuments({
            doctorId: appointment.doctorId._id,
            queueDate: appointment.queueDate,
            queueType: appointment.queueType,
            status: "confirmed",
            tokenSequence: { $lt: effectiveTokenSequence },
            $or: [
                { queueStatus: { $in: activeQueueStatuses } },
                { queueStatus: null },
                { queueStatus: { $exists: false } },
            ],
        });
    }

    return {
        appointment: {
            id: appointment._id,
            status: appointment.status,
            queueStatus:
                appointment.queueStatus ||
                (appointment.status === "confirmed" ? "waiting" : null),
            queueCallCount: appointment.queueCallCount,
            lastCalledAt: appointment.lastCalledAt,
            queueNotificationMessage: appointment.queueNotificationMessage,
            queueType: appointment.queueType,
            queueDate: appointment.queueDate,
            tokenNumber: appointment.tokenNumber,
            tokenSequence: effectiveTokenSequence,
            queueAheadCount,
            urgencyLevel: appointment.urgencyLevel,
            date: appointment.date,
            timeSlot: appointment.timeSlot,
            consultationStartedAt: appointment.consultationStartedAt,
            consultationEndedAt: appointment.consultationEndedAt,
            consultationDurationSeconds: Number.isFinite(
                Number(appointment.consultationDurationSeconds),
            )
                ? Number(appointment.consultationDurationSeconds)
                : appointment.consultationStartedAt &&
                    appointment.consultationEndedAt
                  ? Math.max(
                        0,
                        Math.floor(
                            (new Date(
                                appointment.consultationEndedAt,
                            ).getTime() -
                                new Date(
                                    appointment.consultationStartedAt,
                                ).getTime()) /
                                1000,
                        ),
                    )
                  : null,
            symptoms: appointment.symptoms,
            aiSummary: appointment.aiSummary,
            adminNotes: appointment.adminNotes,
            doctorNotes: appointment.doctorNotes,
            prescription: appointment.prescription,
            adminApprovedBy: appointment.adminApprovedBy?.name,
            adminApprovedAt: appointment.adminApprovedAt,
            cancelledBy: appointment.cancelledBy || null,
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

    if (
        !["pending_payment", "pending_admin_approval", "confirmed"].includes(
            appointment.status,
        )
    ) {
        const error = new Error(
            `Cannot cancel appointment with status: ${appointment.status}`,
        );
        error.statusCode = 400;
        throw error;
    }

    // Fetch details for notification before cancelling
    const [patientUser, doctorUser] = await Promise.all([
        UserModel.findById(userId).select("email"),
        UserModel.findById(appointment.doctorId).select("name"),
    ]);

    await appointment.cancel("Cancelled by patient");
    appointment.cancelledBy = "patient";
    await appointment.save();

    // Fire-and-forget email notification
    notifyAppointmentCancelled(patientUser.email, {
        patientName: patientUser.name,
        doctorName: doctorUser?.name || "N/A",
        date: appointment.date,
        timeSlot: appointment.timeSlot,
    });
};

const getVerifiedDoctors = async (specialization, query = {}) => {
    const { page, limit, skip } = parsePagination(query);
    const doctorQuery = { isVerified: true };
    if (specialization) {
        const escaped = specialization.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        doctorQuery.specialization = {
            $regex: new RegExp(`^${escaped}$`, "i"),
        };
    }

    const [doctors, totalCount] = await Promise.all([
        DoctorModel.find(doctorQuery).skip(skip).limit(limit),
        DoctorModel.countDocuments(doctorQuery),
    ]);
    const doctorUserIds = doctors.map((d) => d.userId);

    const users = await UserModel.find({
        _id: { $in: doctorUserIds },
        isActive: true,
    }).select("name email phone gender profilePhoto");

    const doctorList = doctors
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

    return {
        count: doctorList.length,
        totalCount,
        page,
        totalPages: Math.ceil(totalCount / limit),
        doctors: doctorList,
    };
};

const getPatientProfile = async (userId) => {
    const [user, patient] = await Promise.all([
        UserModel.findById(userId).select(
            "name email phone gender dob addresses profilePhoto",
        ),
        PatientModel.findOne({ userId }),
    ]);

    if (!user) {
        const err = new Error("User not found");
        err.statusCode = 404;
        throw err;
    }

    return {
        user: {
            name: user.name,
            email: user.email,
            phone: user.phone,
            gender: user.gender,
            dob: user.dob,
            addresses: user.addresses,
            profilePhoto: user.profilePhoto,
        },
        medical: {
            mrn: patient?.mrn || null,
            bloodGroup: patient?.bloodGroup || null,
            medicalHistory: patient?.medicalHistory || [],
            allergies: patient?.allergies || [],
            emergencyContact: patient?.emergencyContact || {},
        },
    };
};

const updatePatientProfile = async (userId, updates) => {
    const {
        name,
        phone,
        gender,
        dob,
        addresses,
        bloodGroup,
        medicalHistory,
        allergies,
        emergencyContact,
    } = updates;

    // Update user fields
    const userUpdates = {};
    if (name !== undefined) userUpdates.name = name;
    if (phone !== undefined) userUpdates.phone = phone;
    if (gender !== undefined) userUpdates.gender = gender;
    if (dob !== undefined) userUpdates.dob = dob;
    if (addresses !== undefined) userUpdates.addresses = addresses;

    // Update patient medical fields
    const patientUpdates = {};
    if (bloodGroup !== undefined) patientUpdates.bloodGroup = bloodGroup;
    if (medicalHistory !== undefined)
        patientUpdates.medicalHistory = medicalHistory;
    if (allergies !== undefined) patientUpdates.allergies = allergies;
    if (emergencyContact !== undefined)
        patientUpdates.emergencyContact = emergencyContact;

    const [user, patient] = await Promise.all([
        Object.keys(userUpdates).length > 0
            ? UserModel.findByIdAndUpdate(userId, userUpdates, {
                  new: true,
              }).select("name email phone gender dob addresses profilePhoto")
            : UserModel.findById(userId).select(
                  "name email phone gender dob addresses profilePhoto",
              ),
        Object.keys(patientUpdates).length > 0
            ? PatientModel.findOneAndUpdate({ userId }, patientUpdates, {
                  new: true,
              })
            : PatientModel.findOne({ userId }),
    ]);

    return {
        user: {
            name: user.name,
            email: user.email,
            phone: user.phone,
            gender: user.gender,
            dob: user.dob,
            addresses: user.addresses,
            profilePhoto: user.profilePhoto,
        },
        medical: {
            mrn: patient?.mrn || null,
            bloodGroup: patient?.bloodGroup || null,
            medicalHistory: patient?.medicalHistory || [],
            allergies: patient?.allergies || [],
            emergencyContact: patient?.emergencyContact || {},
        },
    };
};

const getTreatmentSuggestionsForPatient = async (conversationId, userId) => {
    return getTreatmentSuggestions(conversationId, userId);
};

const getEmergencyDelayForDoctor = async (doctorId) => {
    const doctor = await DoctorModel.findOne({ userId: doctorId }).populate(
        "userId",
        "name",
    );

    if (!doctor || !doctor.emergencyState?.isActive) {
        return null;
    }

    return {
        doctorId: doctor.userId._id,
        doctorName: doctor.userId.name,
        reason: doctor.emergencyState.reason,
        activatedAt: doctor.emergencyState.activatedAt,
    };
};

const getPatientNotifications = async (userId) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const appointments = await AppointmentModel.find({
        patientId: userId,
        updatedAt: { $gte: since },
    })
        .populate("doctorId", "name")
        .sort({ updatedAt: -1 })
        .lean();

    const notifications = [];

    for (const apt of appointments) {
        const doctorName = apt.doctorId?.name || "Doctor";
        const dateStr = apt.date ? new Date(apt.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";

        if (apt.status === "pending_admin_approval" && apt.createdAt >= since) {
            notifications.push({ type: "info", title: "Appointment Submitted", message: `Your appointment with Dr. ${doctorName} on ${dateStr} is pending admin review.`, timestamp: apt.createdAt, appointmentId: apt._id });
        }
        if (apt.status === "confirmed" && apt.adminApprovedAt) {
            notifications.push({ type: "success", title: "Appointment Confirmed", message: `Your appointment with Dr. ${doctorName} on ${dateStr} has been confirmed.`, timestamp: apt.adminApprovedAt, appointmentId: apt._id });
        }
        if (apt.status === "rejected" && apt.adminApprovedAt) {
            notifications.push({ type: "error", title: "Appointment Not Approved", message: `Your appointment with Dr. ${doctorName} on ${dateStr} was not approved.`, timestamp: apt.adminApprovedAt, appointmentId: apt._id });
        }
        if (apt.status === "completed" && apt.consultationEndedAt) {
            notifications.push({ type: "success", title: "Consultation Completed", message: `Your consultation with Dr. ${doctorName} on ${dateStr} is complete. Check your prescription.`, timestamp: apt.consultationEndedAt, appointmentId: apt._id });
        }
        if (apt.status === "cancelled" && apt.updatedAt) {
            const isNotVisited = apt.cancelledBy === "not_visited";
            notifications.push({
                type: "warning",
                title: isNotVisited ? "Appointment — Not Visited" : "Appointment Cancelled",
                message: isNotVisited
                    ? `Your appointment with Dr. ${doctorName} on ${dateStr} was marked as not visited.`
                    : `Your appointment with Dr. ${doctorName} on ${dateStr} has been cancelled.`,
                timestamp: apt.updatedAt,
                appointmentId: apt._id,
            });
        }
        if (apt.firstCallEmailSentAt) {
            notifications.push({ type: "urgent", title: "Your Turn — Please Proceed", message: `It is your turn for consultation with Dr. ${doctorName}. Token: ${apt.tokenNumber || "N/A"}.`, timestamp: apt.firstCallEmailSentAt, appointmentId: apt._id });
        }
    }

    notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return notifications.slice(0, 50);
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
    getPatientProfile,
    updatePatientProfile,
    getTreatmentSuggestionsForPatient,
    getEmergencyDelayForDoctor,
    getPatientNotifications,
};
