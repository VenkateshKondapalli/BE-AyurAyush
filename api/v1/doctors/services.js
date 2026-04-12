const { AppointmentModel } = require("../../../models/appointmentSchema");
const { ChatHistoryModel } = require("../../../models/chatHistorySchema");
const { DoctorModel } = require("../../../models/doctorSchema");
const { PatientModel } = require("../../../models/patientSchema");
const { QueueTokenModel } = require("../../../models/queueTokenSchema");
const { UserModel } = require("../../../models/userSchema");
const {
    calculateAge,
    parsePagination,
    generateTokenNumber,
} = require("../../../utils/helpers");
const logger = require("../../../utils/logger");
const {
    notifyAppointmentCompleted,
    notifyPatientTurnCalled,
} = require("../../../utils/appointmentNotifications");

const getConsultationDurationSeconds = (appointment) => {
    if (Number.isFinite(Number(appointment.consultationDurationSeconds))) {
        return Number(appointment.consultationDurationSeconds);
    }

    if (appointment.consultationStartedAt) {
        const start = new Date(appointment.consultationStartedAt).getTime();
        const end = appointment.consultationEndedAt
            ? new Date(appointment.consultationEndedAt).getTime()
            : Date.now();
        const diffSec = Math.max(0, Math.floor((end - start) / 1000));
        return Number.isFinite(diffSec) ? diffSec : null;
    }

    return null;
};

const deriveQueueMeta = (appointment) => {
    let queueStatus = appointment.queueStatus || null;
    let queueCallCount = Number.isFinite(Number(appointment.queueCallCount))
        ? Number(appointment.queueCallCount)
        : 0;

    if (!queueStatus) {
        if (appointment.status === "completed") {
            queueStatus = "completed";
        } else if (appointment.consultationStartedAt) {
            queueStatus = "in_consultation";
        } else if (
            appointment.lastCalledAt ||
            appointment.firstCallEmailSentAt
        ) {
            queueStatus = "called";
        } else if (appointment.status === "confirmed") {
            queueStatus = "waiting";
        }
    }

    if (
        queueCallCount <= 0 &&
        (appointment.lastCalledAt || appointment.firstCallEmailSentAt)
    ) {
        queueCallCount = 1;
    }

    return {
        queueStatus,
        queueCallCount,
    };
};

const assignTokenIfMissing = async (appointment) => {
    if (!appointment || appointment.tokenNumber) {
        return appointment;
    }

    const queueDate = new Date(appointment.date).toISOString().slice(0, 10);
    const queueType = appointment.queueType || "normal";
    const doctorId = appointment.doctorId?._id || appointment.doctorId;

    const tokenDoc = await QueueTokenModel.findOneAndUpdate(
        { queueDate, doctorId, queueType },
        { $inc: { lastSequence: 1 } },
        { upsert: true, new: true },
    );

    const tokenSequence = tokenDoc.lastSequence;
    appointment.tokenSequence = tokenSequence;
    appointment.queueDate = queueDate;
    appointment.tokenNumber = generateTokenNumber(
        queueDate,
        doctorId,
        tokenSequence,
    );
    await appointment.save();
    return appointment;
};

const getDoctorDashboard = async (userId) => {
    let doctor = await DoctorModel.findOne({ userId });

    if (!doctor) {
        doctor = await DoctorModel.create({
            userId,
            specialization: null,
            experience: null,
            isVerified: false,
        });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
        todayAppointmentsCount,
        pendingAppointments,
        completedToday,
        totalPatientsAgg,
        todayAppointmentsDocs,
    ] = await Promise.all([
        AppointmentModel.countDocuments({
            doctorId: userId,
            status: { $nin: ["rejected"] },
            date: { $gte: todayStart, $lte: todayEnd },
        }),
        AppointmentModel.countDocuments({
            doctorId: userId,
            status: "pending_admin_approval",
        }),
        AppointmentModel.countDocuments({
            doctorId: userId,
            status: "completed",
            date: { $gte: todayStart, $lte: todayEnd },
        }),
        AppointmentModel.aggregate([
            {
                $match: {
                    doctorId: userId,
                    status: { $nin: ["rejected"] },
                },
            },
            { $group: { _id: "$patientId" } },
            { $count: "count" },
        ]),
        AppointmentModel.find({
            doctorId: userId,
            status: { $nin: ["rejected"] },
            date: { $gte: todayStart, $lte: todayEnd },
        })
            .populate("patientId", "name")
            .sort({ timeSlot: 1, createdAt: 1 })
            .limit(10),
    ]);

    const totalPatients = totalPatientsAgg[0]?.count || 0;
    const normalizedTodayAppointments = await Promise.all(
        todayAppointmentsDocs.map(assignTokenIfMissing),
    );
    const todayAppointments = normalizedTodayAppointments.map((apt) => ({
        appointmentId: apt._id,
        patient: {
            id: apt.patientId?._id,
            name: apt.patientId?.name || "Patient",
        },
        timeSlot: apt.timeSlot,
        status: apt.status,
        urgencyLevel: apt.urgencyLevel,
        date: apt.date,
        tokenNumber: apt.tokenNumber,
        queueStatus: apt.queueStatus || "waiting",
        queueCallCount: apt.queueCallCount || 0,
        lastCalledAt: apt.lastCalledAt,
        consultationStartedAt: apt.consultationStartedAt,
        consultationEndedAt: apt.consultationEndedAt,
        consultationDurationSeconds: getConsultationDurationSeconds(apt),
    }));

    return {
        doctorId: doctor._id,
        userId: doctor.userId,
        specialization: doctor.specialization,
        experience: doctor.experience,
        isVerified: doctor.isVerified,
        stats: {
            todayAppointments: todayAppointmentsCount,
            pendingAppointments,
            completedAppointments: completedToday,
            totalPatients,
        },
        todayAppointments,
        createdAt: doctor.createdAt,
    };
};

const getDoctorAppointments = async (
    userId,
    { status, date, page: rawPage, limit: rawLimit },
) => {
    const { page, limit, skip } = parsePagination({
        page: rawPage,
        limit: rawLimit,
    });
    const query = {
        doctorId: userId,
        status: { $nin: ["rejected"] },
    };

    if (status) query.status = status;
    if (date) {
        query.date = {
            $gte: new Date(date).setHours(0, 0, 0, 0),
            $lte: new Date(date).setHours(23, 59, 59, 999),
        };
    }

    const [appointments, totalCount] = await Promise.all([
        AppointmentModel.find(query)
            .populate("patientId", "name email phone gender dob profilePhoto")
            .sort({ date: 1, timeSlot: 1 })
            .skip(skip)
            .limit(limit),
        AppointmentModel.countDocuments(query),
    ]);

    // Batch fetch all patient profiles in one query instead of N+1
    const patientUserIds = appointments.map((apt) => apt.patientId._id);
    const patientProfiles = await PatientModel.find({
        userId: { $in: patientUserIds },
    }).select("userId bloodGroup allergies medicalHistory");
    const profileMap = new Map(
        patientProfiles.map((p) => [p.userId.toString(), p]),
    );

    const appointmentsWithDetails = appointments.map((apt) => {
        const patientProfile = profileMap.get(apt.patientId._id.toString());
        const derivedQueue = deriveQueueMeta(apt);

        return {
            appointmentId: apt._id,
            status: apt.status,
            urgencyLevel: apt.urgencyLevel,
            tokenNumber: apt.tokenNumber,
            tokenSequence: apt.tokenSequence,
            queueType: apt.queueType,
            queueStatus: derivedQueue.queueStatus,
            queueCallCount: derivedQueue.queueCallCount,
            lastCalledAt: apt.lastCalledAt,
            queueNotificationMessage: apt.queueNotificationMessage || "",
            consultationStartedAt: apt.consultationStartedAt,
            consultationEndedAt: apt.consultationEndedAt,
            consultationDurationSeconds: getConsultationDurationSeconds(apt),
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
    });

    const emergencyAppointments = appointmentsWithDetails.filter(
        (a) => a.urgencyLevel === "emergency",
    );
    const normalAppointments = appointmentsWithDetails.filter(
        (a) => a.urgencyLevel === "normal",
    );

    return {
        totalCount,
        page,
        totalPages: Math.ceil(totalCount / limit),
        emergencyCount: emergencyAppointments.length,
        normalCount: normalAppointments.length,
        emergencyAppointments,
        normalAppointments,
    };
};

const getTodayAppointments = async (userId) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const appointments = await AppointmentModel.find({
        doctorId: userId,
        status: { $nin: ["rejected"] },
        date: { $gte: todayStart, $lte: todayEnd },
    })
        .populate("patientId", "name email phone gender dob profilePhoto")
        .sort({ timeSlot: 1 });

    const normalizedAppointments = await Promise.all(
        appointments.map(assignTokenIfMissing),
    );

    // Batch fetch all patient profiles in one query
    const patientUserIds = normalizedAppointments.map(
        (apt) => apt.patientId._id,
    );
    const patientProfiles = await PatientModel.find({
        userId: { $in: patientUserIds },
    }).select("userId bloodGroup allergies emergencyContact");
    const profileMap = new Map(
        patientProfiles.map((p) => [p.userId.toString(), p]),
    );

    const appointmentsWithDetails = normalizedAppointments.map((apt) => {
        const patientProfile = profileMap.get(apt.patientId._id.toString());
        const derivedQueue = deriveQueueMeta(apt);

        return {
            appointmentId: apt._id,
            status: apt.status,
            date: apt.date,
            urgencyLevel: apt.urgencyLevel,
            timeSlot: apt.timeSlot,
            tokenNumber: apt.tokenNumber,
            tokenSequence: apt.tokenSequence,
            queueType: apt.queueType,
            queueStatus: derivedQueue.queueStatus,
            queueCallCount: derivedQueue.queueCallCount,
            lastCalledAt: apt.lastCalledAt,
            queueNotificationMessage: apt.queueNotificationMessage || "",
            consultationStartedAt: apt.consultationStartedAt,
            consultationEndedAt: apt.consultationEndedAt,
            consultationDurationSeconds: getConsultationDurationSeconds(apt),
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
    });

    return {
        date: new Date().toISOString().split("T")[0],
        totalCount: appointmentsWithDetails.length,
        appointments: appointmentsWithDetails.sort((a, b) => {
            const aSeq = Number.isFinite(Number(a.tokenSequence))
                ? Number(a.tokenSequence)
                : Number.MAX_SAFE_INTEGER;
            const bSeq = Number.isFinite(Number(b.tokenSequence))
                ? Number(b.tokenSequence)
                : Number.MAX_SAFE_INTEGER;
            if (aSeq !== bSeq) return aSeq - bSeq;
            return String(a.timeSlot || "").localeCompare(
                String(b.timeSlot || ""),
            );
        }),
    };
};

const updateQueueCallState = async (appointment, doctorName) => {
    const firstCall = !appointment.firstCallEmailSentAt;
    const now = new Date();

    appointment.queueStatus = "called";
    appointment.queueCallCount = (appointment.queueCallCount || 0) + 1;
    appointment.lastCalledAt = now;
    appointment.queueNotificationMessage = firstCall
        ? "Please proceed to consultation area."
        : "Reminder: Your consultation turn is active.";

    if (firstCall) {
        appointment.firstCallEmailSentAt = now;
        notifyPatientTurnCalled(appointment.patientId?.email, {
            patientName: appointment.patientId?.name,
            doctorName: doctorName || "Doctor",
            date: appointment.date,
            timeSlot: appointment.timeSlot,
            tokenNumber: appointment.tokenNumber,
        });
    }

    await appointment.save();

    return {
        appointmentId: appointment._id,
        queueStatus: appointment.queueStatus,
        queueCallCount: appointment.queueCallCount,
        firstCallEmailSent: firstCall,
        notificationMode: firstCall ? "email_and_in_app" : "in_app_only",
        tokenNumber: appointment.tokenNumber,
    };
};

const callTodayQueuePatient = async (userId, appointmentId) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [appointment, doctor] = await Promise.all([
        AppointmentModel.findOne({
            _id: appointmentId,
            doctorId: userId,
            status: "confirmed",
            date: { $gte: todayStart, $lte: todayEnd },
        }).populate("patientId", "name email"),
        UserModel.findById(userId).select("name"),
    ]);

    if (!appointment) {
        const err = new Error("Today's confirmed appointment not found");
        err.statusCode = 404;
        throw err;
    }

    await assignTokenIfMissing(appointment);
    return updateQueueCallState(appointment, doctor?.name);
};

const callNextQueuePatient = async (userId) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [doctor, appointments] = await Promise.all([
        UserModel.findById(userId).select("name"),
        AppointmentModel.find({
            doctorId: userId,
            status: "confirmed",
            date: { $gte: todayStart, $lte: todayEnd },
        })
            .populate("patientId", "name email")
            .sort({ tokenSequence: 1, timeSlot: 1, createdAt: 1 }),
    ]);

    const normalized = await Promise.all(
        appointments.map(assignTokenIfMissing),
    );
    const nextAppointment = normalized.find(
        (apt) => !apt.queueStatus || apt.queueStatus === "waiting",
    );

    if (!nextAppointment) {
        const err = new Error("No waiting patients in today's queue");
        err.statusCode = 400;
        throw err;
    }

    return updateQueueCallState(nextAppointment, doctor?.name);
};

const startConsultation = async (userId, appointmentId) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const appointment = await AppointmentModel.findOne({
        _id: appointmentId,
        doctorId: userId,
        status: "confirmed",
        date: { $gte: todayStart, $lte: todayEnd },
    }).populate("patientId", "name");

    if (!appointment) {
        const err = new Error("Today's confirmed appointment not found");
        err.statusCode = 404;
        throw err;
    }

    await assignTokenIfMissing(appointment);
    appointment.queueStatus = "in_consultation";
    appointment.queueNotificationMessage = "You are currently in consultation.";
    if (!appointment.consultationStartedAt) {
        appointment.consultationStartedAt = new Date();
    }
    appointment.consultationEndedAt = null;
    appointment.consultationDurationSeconds = null;
    await appointment.save();

    return {
        appointmentId: appointment._id,
        queueStatus: appointment.queueStatus,
        patientName: appointment.patientId?.name || "Patient",
        tokenNumber: appointment.tokenNumber,
        consultationStartedAt: appointment.consultationStartedAt,
    };
};

const getAppointmentDetail = async (userId, appointmentId) => {
    const appointment = await AppointmentModel.findOne({
        _id: appointmentId,
        doctorId: userId,
    }).populate("patientId", "name email phone gender dob profilePhoto");

    if (!appointment) {
        const err = new Error("Appointment not found");
        err.statusCode = 404;
        throw err;
    }

    const patientProfile = await PatientModel.findOne({
        userId: appointment.patientId._id,
    });

    const chatHistory = await ChatHistoryModel.findOne({
        conversationId: appointment.chatConversationId,
    });

    return {
        appointment: {
            id: appointment._id,
            status: appointment.status,
            urgencyLevel: appointment.urgencyLevel,
            date: appointment.date,
            timeSlot: appointment.timeSlot,
            queueStatus: deriveQueueMeta(appointment).queueStatus,
            queueCallCount: deriveQueueMeta(appointment).queueCallCount,
            lastCalledAt: appointment.lastCalledAt,
            queueNotificationMessage:
                appointment.queueNotificationMessage || "",
            consultationStartedAt: appointment.consultationStartedAt,
            consultationEndedAt: appointment.consultationEndedAt,
            consultationDurationSeconds:
                getConsultationDurationSeconds(appointment),
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
    };
};

const completeAppointment = async (
    userId,
    appointmentId,
    { doctorNotes, prescription },
) => {
    const appointment = await AppointmentModel.findOne({
        _id: appointmentId,
        doctorId: userId,
    });

    if (!appointment) {
        const err = new Error("Appointment not found");
        err.statusCode = 404;
        throw err;
    }

    if (appointment.status !== "confirmed") {
        const err = new Error("Only confirmed appointments can be completed");
        err.statusCode = 400;
        throw err;
    }

    await appointment.markCompleted(prescription, doctorNotes);
    appointment.queueStatus = "completed";
    appointment.queueNotificationMessage = "Consultation completed.";
    if (appointment.consultationStartedAt && !appointment.consultationEndedAt) {
        appointment.consultationEndedAt = new Date();
    }
    if (appointment.consultationStartedAt) {
        const start = new Date(appointment.consultationStartedAt).getTime();
        const end = appointment.consultationEndedAt
            ? new Date(appointment.consultationEndedAt).getTime()
            : Date.now();
        appointment.consultationDurationSeconds = Math.max(
            0,
            Math.floor((end - start) / 1000),
        );
    }
    await appointment.save();

    // Fetch patient and doctor info for notification
    const [patientUser, doctorUser] = await Promise.all([
        UserModel.findById(appointment.patientId).select("email"),
        UserModel.findById(userId).select("name"),
    ]);

    // Fire-and-forget email notification
    notifyAppointmentCompleted(patientUser.email, {
        doctorName: doctorUser.name,
        date: appointment.date,
        hasPrescription: !!prescription,
    });

    return {
        appointmentId: appointment._id,
        status: appointment.status,
    };
};

const getDoctorProfile = async (userId) => {
    const [user, doctor] = await Promise.all([
        UserModel.findById(userId).select(
            "name email phone gender dob addresses profilePhoto",
        ),
        DoctorModel.findOne({ userId }),
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
        professional: {
            specialization: doctor?.specialization,
            qualification: doctor?.qualification,
            experience: doctor?.experience,
            licenseNumber: doctor?.licenseNumber,
            consultationFee: doctor?.consultationFee,
            availableModes: doctor?.availableModes || [],
            isVerified: doctor?.isVerified || false,
        },
    };
};

const updateDoctorProfile = async (userId, updates) => {
    const {
        name,
        phone,
        gender,
        dob,
        addresses,
        consultationFee,
        availableModes,
    } = updates;

    // Update user fields
    const userUpdates = {};
    if (name !== undefined) userUpdates.name = name;
    if (phone !== undefined) userUpdates.phone = phone;
    if (gender !== undefined) userUpdates.gender = gender;
    if (dob !== undefined) userUpdates.dob = dob;
    if (addresses !== undefined) userUpdates.addresses = addresses;

    // Update doctor-editable fields (not specialization/qualification/license — those go through admin)
    const doctorUpdates = {};
    if (consultationFee !== undefined)
        doctorUpdates.consultationFee = consultationFee;
    if (availableModes !== undefined)
        doctorUpdates.availableModes = availableModes;

    const [user, doctor] = await Promise.all([
        Object.keys(userUpdates).length > 0
            ? UserModel.findByIdAndUpdate(userId, userUpdates, {
                  new: true,
              }).select("name email phone gender dob addresses profilePhoto")
            : UserModel.findById(userId).select(
                  "name email phone gender dob addresses profilePhoto",
              ),
        Object.keys(doctorUpdates).length > 0
            ? DoctorModel.findOneAndUpdate({ userId }, doctorUpdates, {
                  new: true,
              })
            : DoctorModel.findOne({ userId }),
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
        professional: {
            specialization: doctor?.specialization,
            qualification: doctor?.qualification,
            experience: doctor?.experience,
            licenseNumber: doctor?.licenseNumber,
            consultationFee: doctor?.consultationFee,
            availableModes: doctor?.availableModes || [],
            isVerified: doctor?.isVerified || false,
        },
    };
};

module.exports = {
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
};
