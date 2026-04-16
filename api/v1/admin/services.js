const mongoose = require("mongoose");
const { customAlphabet } = require("nanoid");
const { PaymentModel } = require("../../../models/paymentSchema");
const { razorpay } = require("../../../utils/razorpayInstance");
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
    EmergencyPatientModel,
} = require("../../../models/emergencyPatientSchema");
const { QueueTokenModel } = require("../../../models/queueTokenSchema");
const {
    calculateAge,
    calculateWaitingTime,
    generateTokenNumber,
    parsePagination,
    getISTDateKey,
    getISTDayBounds,
} = require("../../../utils/helpers");
const {
    notifyAppointmentApproved,
    notifyAppointmentRejected,
    notifyDoctorOnboarded,
    notifyPatientTurnCalled,
} = require("../../../utils/appointmentNotifications");
const logger = require("../../../utils/logger");

const generateTemporaryPassword = customAlphabet(
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789",
    12,
);

const assignTokenIfMissing = async (appointment) => {
    if (!appointment || appointment.tokenNumber) {
        return appointment;
    }

    const queueDate = getISTDateKey(appointment.date);
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

const getQueueDeliveryMeta = (appointment) => {
    const notifications = Array.isArray(appointment.queueNotificationHistory)
        ? appointment.queueNotificationHistory
        : [];
    const lastNotification =
        notifications.length > 0
            ? notifications[notifications.length - 1]
            : null;

    if (!lastNotification) {
        return {
            deliveryStatus:
                Number(appointment.queueCallCount || 0) > 0
                    ? "delivered"
                    : "not_sent",
            lastNotification: null,
        };
    }

    return {
        deliveryStatus: lastNotification.deliveryStatus || "unknown",
        lastNotification: {
            channel: lastNotification.channel || "in_app_only",
            sentAt: lastNotification.sentAt || null,
            actorRole: lastNotification.actorRole || "system",
            deliveryStatus: lastNotification.deliveryStatus || "unknown",
            message: lastNotification.message || "",
        },
    };
};

const appendQueueAudit = (appointment, eventData) => {
    appointment.queueAuditTrail = Array.isArray(appointment.queueAuditTrail)
        ? appointment.queueAuditTrail
        : [];
    appointment.queueAuditTrail.push({
        at: new Date(),
        ...eventData,
    });
};

const SLOT_CAPACITY = 2;

const buildSlotCountMap = (appointments) => {
    const map = {};
    appointments.forEach((apt) => {
        const doctorId = (apt.doctorId?._id || apt.doctorId).toString();
        const key = `${doctorId}__${apt.timeSlot}`;
        map[key] = (map[key] || 0) + 1;
    });
    return map;
};

const getDashboardStats = async () => {
    const { start: todayStart, end: todayEnd } = getISTDayBounds();

    const [
        totalUsers,
        totalDoctors,
        totalPatients,
        todayAppointments,
        pendingApprovals,
        recentAppointmentsDocs,
    ] = await Promise.all([
        UserModel.countDocuments(),
        UserModel.countDocuments({ roles: "doctor" }),
        UserModel.countDocuments({ roles: "patient" }),
        AppointmentModel.countDocuments({
            date: { $gte: todayStart, $lte: todayEnd },
            status: { $nin: ["cancelled", "rejected"] },
        }),
        AppointmentModel.countDocuments({ status: "pending_admin_approval" }),
        AppointmentModel.find({})
            .populate("patientId", "name")
            .populate("doctorId", "name")
            .sort({ createdAt: -1 })
            .limit(10),
    ]);

    const recentAppointments = recentAppointmentsDocs.map((apt) => ({
        appointmentId: apt._id,
        patient: {
            id: apt.patientId?._id,
            name: apt.patientId?.name || "Unknown",
        },
        doctor: {
            id: apt.doctorId?._id,
            name: apt.doctorId?.name || "Unassigned",
        },
        date: apt.date,
        timeSlot: apt.timeSlot,
        urgencyLevel: apt.urgencyLevel,
        status: apt.status,
        createdAt: apt.createdAt,
    }));

    return {
        stats: {
            totalUsers,
            totalDoctors,
            totalPatients,
            todayAppointments,
            pendingApprovals,
        },
        recentAppointments,
    };
};

const createDoctorAccountByAdmin = async (adminUserId, payload) => {
    const {
        name,
        email,
        phone,
        gender,
        dob,
        qualification,
        specialization,
        experience,
        licenseNumber,
        consultationFee,
        availableModes,
    } = payload;

    const existingUser = await UserModel.findOne({
        $or: [{ email }, { phone }],
    }).select("_id email phone");

    if (existingUser) {
        const err = new Error(
            existingUser.email === email
                ? "Email already exists"
                : "Phone already exists",
        );
        err.statusCode = 409;
        throw err;
    }

    const temporaryPassword = generateTemporaryPassword();

    const session = await mongoose.startSession();
    let createdUser;
    let createdDoctor;

    try {
        await session.withTransaction(async () => {
            const users = await UserModel.create(
                [
                    {
                        name,
                        email,
                        phone,
                        gender,
                        dob,
                        password: temporaryPassword,
                        roles: [ROLE_OPTIONS.DOCTOR],
                        mustChangePassword: true,
                    },
                ],
                { session },
            );
            createdUser = users[0];

            const doctors = await DoctorModel.create(
                [
                    {
                        userId: createdUser._id,
                        qualification,
                        specialization,
                        experience,
                        licenseNumber,
                        consultationFee,
                        availableModes: availableModes || [],
                        isVerified: true,
                        verifiedAt: new Date(),
                    },
                ],
                { session },
            );
            createdDoctor = doctors[0];
        });
    } finally {
        await session.endSession();
    }

    const loginUrl = `${process.env.FRONTEND_URL_LOCAL || "http://localhost:5173"}/login`;

    notifyDoctorOnboarded(email, {
        doctorName: name,
        temporaryPassword,
        loginUrl,
    });

    return {
        userId: createdUser._id,
        doctorId: createdDoctor._id,
        email: createdUser.email,
        name: createdUser.name,
        specialization: createdDoctor.specialization,
        qualification: createdDoctor.qualification,
        isVerified: createdDoctor.isVerified,
        mustChangePassword: createdUser.mustChangePassword,
        createdByAdmin: adminUserId,
    };
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

    // Use a transaction to ensure all 3 writes succeed or none do
    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            application.status = "approved";
            application.reviewedBy = adminUserId;
            application.reviewedAt = new Date();
            await application.save({ session });

            await UserModel.findByIdAndUpdate(
                application.userId,
                { $addToSet: { roles: ROLE_OPTIONS.DOCTOR } },
                { session },
            );

            await DoctorModel.create(
                [
                    {
                        userId: application.userId,
                        specialization: application.specialization,
                        experience: application.experience,
                        qualification: application.qualification,
                        licenseNumber: application.licenseNumber,
                        isVerified: true,
                        verifiedAt: new Date(),
                    },
                ],
                { session },
            );
        });
    } finally {
        await session.endSession();
    }
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

const getPendingNormalAppointments = async (query = {}) => {
    const { page, limit, skip } = parsePagination(query);
    const filter = {
        status: "pending_admin_approval",
        urgencyLevel: "normal",
    };

    const [appointments, totalCount] = await Promise.all([
        AppointmentModel.find(filter)
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(limit),
        AppointmentModel.countDocuments(filter),
    ]);

    // Batch fetch all doctor profiles in one query
    const doctorUserIds = appointments
        .map((apt) => apt.doctorId?._id || apt.doctorId)
        .filter(Boolean);
    const doctorProfiles = await DoctorModel.find({
        userId: { $in: doctorUserIds },
    }).select("userId specialization qualification experience");
    const doctorMap = new Map(
        doctorProfiles.map((d) => [d.userId.toString(), d]),
    );

    const patientUserIds = appointments
        .map((apt) => apt.patientId?._id || apt.patientId)
        .filter(Boolean)
        .map((id) => id.toString());
    const doctorResolvedUserIds = appointments
        .map((apt) => apt.doctorId?._id || apt.doctorId)
        .filter(Boolean)
        .map((id) => id.toString());

    const [patientProfilesById, doctorProfilesById] = await Promise.all([
        PatientModel.find({ _id: { $in: patientUserIds } })
            .select("_id userId")
            .lean(),
        DoctorModel.find({ _id: { $in: doctorResolvedUserIds } })
            .select("_id userId")
            .lean(),
    ]);

    const patientProfileMap = new Map(
        patientProfilesById.map((p) => [p._id.toString(), p.userId.toString()]),
    );
    const doctorProfileMap = new Map(
        doctorProfilesById.map((d) => [d._id.toString(), d.userId.toString()]),
    );

    const resolvedPatientUserIds = patientUserIds.map(
        (id) => patientProfileMap.get(id) || id,
    );
    const resolvedDoctorUserIds = doctorResolvedUserIds.map(
        (id) => doctorProfileMap.get(id) || id,
    );

    const users = await UserModel.find({
        _id: {
            $in: [
                ...new Set([
                    ...resolvedPatientUserIds,
                    ...resolvedDoctorUserIds,
                ]),
            ],
        },
    }).select("name email phone gender dob");
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));
    const slotCountMap = buildSlotCountMap(appointments);

    // Batch fetch payment status for all appointments
    const appointmentIds = appointments.map((apt) => apt._id);
    const payments = await PaymentModel.find({
        appointmentId: { $in: appointmentIds },
    }).select("appointmentId status razorpayPaymentId paidAt amount");
    const paymentMap = new Map(
        payments.map((p) => [p.appointmentId.toString(), p]),
    );

    const result = appointments.map((apt) => {
        const rawDoctorId = (apt.doctorId?._id || apt.doctorId)?.toString();
        const rawPatientId = (apt.patientId?._id || apt.patientId)?.toString();
        const doctorUserId = doctorProfileMap.get(rawDoctorId) || rawDoctorId;
        const patientUserId =
            patientProfileMap.get(rawPatientId) || rawPatientId;

        const doctor = doctorMap.get(doctorUserId);
        const patientUser = userMap.get(patientUserId);
        const doctorUser = userMap.get(doctorUserId);
        const slotKey = `${rawDoctorId}__${apt.timeSlot}`;
        const payment = paymentMap.get(apt._id.toString());

        return {
            appointmentId: apt._id,
            status: apt.status,
            urgencyLevel: apt.urgencyLevel,
            date: apt.date,
            timeSlot: apt.timeSlot,
            patient: {
                id: patientUserId,
                name: apt.patientId?.name || patientUser?.name || "Unknown",
                email: apt.patientId?.email || patientUser?.email,
                phone: apt.patientId?.phone || patientUser?.phone,
                gender: apt.patientId?.gender || patientUser?.gender,
                age: calculateAge(apt.patientId?.dob || patientUser?.dob),
            },
            doctor: {
                id: doctorUserId,
                name: apt.doctorId?.name || doctorUser?.name || "Unassigned",
                specialization: doctor?.specialization,
            },
            patientName: apt.patientId?.name || patientUser?.name || "Unknown",
            doctorName: apt.doctorId?.name || doctorUser?.name || "Unassigned",
            appointmentDetails: {
                date: apt.date,
                timeSlot: apt.timeSlot,
                symptoms: apt.symptoms,
                aiSummary: apt.aiSummary,
                urgencyLevel: apt.urgencyLevel,
            },
            createdAt: apt.createdAt,
            waitingTime: calculateWaitingTime(apt.createdAt),
            slotBookingCount: slotCountMap[slotKey] || 1,
            slotCapacity: SLOT_CAPACITY,
            payment: payment
                ? {
                      status: payment.status,
                      razorpayPaymentId: payment.razorpayPaymentId,
                      paidAt: payment.paidAt,
                      amount: payment.amount ? Number((payment.amount / 100).toFixed(2)) : null,
                  }
                : null,
        };
    });

    return {
        count: result.length,
        totalCount,
        page,
        totalPages: Math.ceil(totalCount / limit),
        appointments: result,
    };
};

const getEmergencyAppointments = async (query = {}) => {
    const { page, limit, skip } = parsePagination(query);
    const filter = {
        status: "pending_admin_approval",
        urgencyLevel: "emergency",
    };

    const [appointments, totalCount] = await Promise.all([
        AppointmentModel.find(filter)
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(limit),
        AppointmentModel.countDocuments(filter),
    ]);

    // Batch fetch doctor profiles and chat histories in parallel
    const doctorUserIds = appointments
        .map((apt) => apt.doctorId?._id || apt.doctorId)
        .filter(Boolean);
    const conversationIds = appointments
        .map((apt) => apt.chatConversationId)
        .filter(Boolean);

    const patientUserIds = appointments
        .map((apt) => apt.patientId?._id || apt.patientId)
        .filter(Boolean)
        .map((id) => id.toString());
    const doctorResolvedUserIds = appointments
        .map((apt) => apt.doctorId?._id || apt.doctorId)
        .filter(Boolean)
        .map((id) => id.toString());

    const [patientProfilesById, doctorProfilesById] = await Promise.all([
        PatientModel.find({ _id: { $in: patientUserIds } })
            .select("_id userId")
            .lean(),
        DoctorModel.find({ _id: { $in: doctorResolvedUserIds } })
            .select("_id userId")
            .lean(),
    ]);

    const patientProfileMap = new Map(
        patientProfilesById.map((p) => [p._id.toString(), p.userId.toString()]),
    );
    const doctorProfileMap = new Map(
        doctorProfilesById.map((d) => [d._id.toString(), d.userId.toString()]),
    );

    const resolvedPatientUserIds = patientUserIds.map(
        (id) => patientProfileMap.get(id) || id,
    );
    const resolvedDoctorUserIds = doctorResolvedUserIds.map(
        (id) => doctorProfileMap.get(id) || id,
    );

    const [doctorProfiles, chatHistories, users] = await Promise.all([
        DoctorModel.find({ userId: { $in: doctorUserIds } }).select(
            "userId specialization qualification experience",
        ),
        ChatHistoryModel.find({
            conversationId: { $in: conversationIds },
        }).select("conversationId messages"),
        UserModel.find({
            _id: {
                $in: [
                    ...new Set([
                        ...resolvedPatientUserIds,
                        ...resolvedDoctorUserIds,
                    ]),
                ],
            },
        }).select("name email phone gender dob"),
    ]);

    const doctorMap = new Map(
        doctorProfiles.map((d) => [d.userId.toString(), d]),
    );
    const chatMap = new Map(chatHistories.map((c) => [c.conversationId, c]));
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));
    const slotCountMap = buildSlotCountMap(appointments);

    const result = appointments.map((apt) => {
        const rawDoctorId = (apt.doctorId?._id || apt.doctorId)?.toString();
        const rawPatientId = (apt.patientId?._id || apt.patientId)?.toString();
        const doctorUserId = doctorProfileMap.get(rawDoctorId) || rawDoctorId;
        const patientUserId =
            patientProfileMap.get(rawPatientId) || rawPatientId;

        const doctor = doctorMap.get(doctorUserId);
        const patientUser = userMap.get(patientUserId);
        const doctorUser = userMap.get(doctorUserId);
        const chatHistory = chatMap.get(apt.chatConversationId);
        const slotKey = `${rawDoctorId}__${apt.timeSlot}`;

        return {
            appointmentId: apt._id,
            status: apt.status,
            urgencyLevel: apt.urgencyLevel,
            date: apt.date,
            timeSlot: apt.timeSlot,
            patient: {
                id: patientUserId,
                name: apt.patientId?.name || patientUser?.name || "Unknown",
                email: apt.patientId?.email || patientUser?.email,
                phone: apt.patientId?.phone || patientUser?.phone,
                gender: apt.patientId?.gender || patientUser?.gender,
                age: calculateAge(apt.patientId?.dob || patientUser?.dob),
            },
            doctor: {
                id: doctorUserId,
                name: apt.doctorId?.name || doctorUser?.name || "Unassigned",
                specialization: doctor?.specialization,
            },
            patientName: apt.patientId?.name || patientUser?.name || "Unknown",
            doctorName: apt.doctorId?.name || doctorUser?.name || "Unassigned",
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
            priority: "URGENT - EMERGENCY",
            slotBookingCount: slotCountMap[slotKey] || 1,
            slotCapacity: SLOT_CAPACITY,
        };
    });

    return {
        count: result.length,
        totalCount,
        page,
        totalPages: Math.ceil(totalCount / limit),
        appointments: result,
    };
};

const getTodayQueue = async () => {
    const { start: todayStart, end: todayEnd } = getISTDayBounds();

    const appointments = await AppointmentModel.find({
        date: { $gte: todayStart, $lte: todayEnd },
        status: { $in: ["confirmed", "completed"] },
    })
        .populate("patientId", "name email")
        .populate("emergencyPatientId", "displayName phone wardLocation")
        .populate("doctorId", "name")
        .sort({ tokenSequence: 1, timeSlot: 1, createdAt: 1 });

    const normalizedAppointments = await Promise.all(
        appointments.map(assignTokenIfMissing),
    );

    const slotCountMap = buildSlotCountMap(normalizedAppointments);

    const queue = normalizedAppointments.map((apt) => {
        const deliveryMeta = getQueueDeliveryMeta(apt);
        const doctorId = (apt.doctorId?._id || apt.doctorId).toString();
        const slotKey = `${doctorId}__${apt.timeSlot}`;
        return {
            appointmentId: apt._id,
            status: apt.status,
            tokenNumber: apt.tokenNumber,
            queueStatus: apt.queueStatus || "waiting",
            queueCallCount: apt.queueCallCount || 0,
            lastCalledAt: apt.lastCalledAt,
            queueNotificationMessage: apt.queueNotificationMessage || "",
            consultationStartedAt: apt.consultationStartedAt,
            consultationEndedAt: apt.consultationEndedAt,
            consultationDurationSeconds: Number.isFinite(
                Number(apt.consultationDurationSeconds),
            )
                ? Number(apt.consultationDurationSeconds)
                : apt.consultationStartedAt
                  ? Math.max(
                        0,
                        Math.floor(
                            ((apt.consultationEndedAt
                                ? new Date(apt.consultationEndedAt).getTime()
                                : Date.now()) -
                                new Date(apt.consultationStartedAt).getTime()) /
                                1000,
                        ),
                    )
                  : null,
            deliveryStatus: deliveryMeta.deliveryStatus,
            lastNotification: deliveryMeta.lastNotification,
            date: apt.date,
            timeSlot: apt.timeSlot,
            queueType: apt.queueType || "normal",
            patient: {
                id: apt.patientId?._id || apt.emergencyPatientId?._id,
                name:
                    apt.patientId?.name ||
                    apt.emergencyPatientId?.displayName ||
                    "Patient",
                email: apt.patientId?.email,
                phone: apt.emergencyPatientId?.phone || "",
                wardLocation: apt.emergencyPatientId?.wardLocation || "",
                isEmergencyTriage: !!apt.emergencyPatientId,
            },
            doctor: {
                id: apt.doctorId?._id,
                name: apt.doctorId?.name || "Unassigned",
            },
            slotBookingCount: slotCountMap[slotKey] || 1,
            slotCapacity: SLOT_CAPACITY,
        };
    });

    return {
        count: queue.length,
        appointments: queue,
    };
};

const callTodayQueuePatient = async (appointmentId, adminUserId) => {
    const { start: todayStart, end: todayEnd } = getISTDayBounds();

    const appointment = await AppointmentModel.findOne({
        _id: appointmentId,
        date: { $gte: todayStart, $lte: todayEnd },
        status: "confirmed",
    })
        .populate("patientId", "name email")
        .populate("emergencyPatientId", "displayName")
        .populate("doctorId", "name");

    if (!appointment) {
        const err = new Error("Today's confirmed appointment not found");
        err.statusCode = 404;
        throw err;
    }

    await assignTokenIfMissing(appointment);

    const now = new Date();
    const firstCall = !appointment.firstCallEmailSentAt;
    const previousQueueStatus = appointment.queueStatus || "waiting";

    appointment.queueStatus = "called";
    appointment.queueCallCount = (appointment.queueCallCount || 0) + 1;
    appointment.lastCalledAt = now;
    appointment.queueNotificationMessage = firstCall
        ? "Please proceed to consultation area."
        : "Reminder: Your consultation turn is active.";
    appointment.adminApprovedBy = appointment.adminApprovedBy || adminUserId;

    if (firstCall) {
        appointment.firstCallEmailSentAt = now;
        if (appointment.patientId?.email) {
            notifyPatientTurnCalled(appointment.patientId.email, {
                patientName: appointment.patientId?.name,
                doctorName: appointment.doctorId?.name || "Doctor",
                date: appointment.date,
                timeSlot: appointment.timeSlot,
                tokenNumber: appointment.tokenNumber,
            });
        }
    }

    appointment.queueNotificationHistory = Array.isArray(
        appointment.queueNotificationHistory,
    )
        ? appointment.queueNotificationHistory
        : [];
    appointment.queueNotificationHistory.push({
        sentAt: now,
        channel: firstCall ? "email_and_in_app" : "in_app_only",
        deliveryStatus: "delivered",
        actorRole: "admin",
        actorId: adminUserId,
        message: appointment.queueNotificationMessage,
    });

    appendQueueAudit(appointment, {
        event: firstCall ? "patient_notified" : "patient_reminded",
        fromStatus: previousQueueStatus,
        toStatus: "called",
        actorRole: "admin",
        actorId: adminUserId,
        note: firstCall
            ? "First notification sent (email + in-app)."
            : "Reminder notification sent (in-app).",
    });

    await appointment.save();

    return {
        appointmentId: appointment._id,
        queueStatus: appointment.queueStatus,
        queueCallCount: appointment.queueCallCount,
        firstCallEmailSent: firstCall,
        notificationMode: firstCall ? "email_and_in_app" : "in_app_only",
        patientName:
            appointment.patientId?.name ||
            appointment.emergencyPatientId?.displayName ||
            "Patient",
        tokenNumber: appointment.tokenNumber,
    };
};

const getQueueInsights = async () => {
    const { start: todayStart, end: todayEnd } = getISTDayBounds();
    const slaThresholdSeconds = 20 * 60;

    const appointments = await AppointmentModel.find({
        date: { $gte: todayStart, $lte: todayEnd },
        status: { $in: ["confirmed", "completed"] },
    })
        .populate("patientId", "name")
        .populate("doctorId", "name")
        .sort({ createdAt: 1 });

    const now = Date.now();

    const createAggregate = () => ({
        longestWait: {
            appointmentId: null,
            patientName: "",
            doctorName: "",
            waitingForSeconds: 0,
            queueStatus: "waiting",
            tokenNumber: "",
        },
        activeWaitTotal: 0,
        activeWaitCount: 0,
        slaBreaches: 0,
        bottleneckMap: new Map(),
        notificationsSent: 0,
        notificationsDelivered: 0,
        notificationsViaEmail: 0,
        notificationsInAppOnly: 0,
    });

    const aggregates = {
        global: createAggregate(),
        ayurveda: createAggregate(),
        panchakarma: createAggregate(),
        normal: createAggregate(),
    };

    const getSlotStartMs = (appointment) => {
        const slot = String(appointment.timeSlot || "");
        const startPart = slot.split("-")[0]?.trim() || "";
        const match = startPart.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
        if (!match) {
            return null;
        }

        let hours = Number(match[1]);
        const minutes = Number(match[2]);
        const meridiem = match[3] ? match[3].toUpperCase() : null;

        if (meridiem) {
            if (meridiem === "PM" && hours < 12) {
                hours += 12;
            }
            if (meridiem === "AM" && hours === 12) {
                hours = 0;
            }
        }

        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
            return null;
        }

        const { start: dayStart } = getISTDayBounds(
            appointment.date || Date.now(),
        );
        return dayStart.getTime() + (hours * 60 + minutes) * 60 * 1000;
    };

    appointments.forEach((apt) => {
        let waitSec = 0;
        const nowMs = now;
        const slotStartMs = getSlotStartMs(apt);
        const consultationStartMs = apt.consultationStartedAt
            ? new Date(apt.consultationStartedAt).getTime()
            : null;
        const waitUntilMs = consultationStartMs || nowMs;

        if (slotStartMs) {
            const diffMs = waitUntilMs - slotStartMs;
            if (diffMs > 0) {
                waitSec = Math.floor(diffMs / 1000);
            }
        }

        const isActiveQueue =
            apt.status === "confirmed" &&
            ["waiting", "called", "in_consultation"].includes(
                apt.queueStatus || "waiting",
            );

        const updateAgg = (agg) => {
            if (waitSec > 0) {
                agg.activeWaitTotal += waitSec;
                agg.activeWaitCount += 1;
                if (waitSec > slaThresholdSeconds) {
                    agg.slaBreaches += 1;
                }
            }

            if (isActiveQueue && waitSec > agg.longestWait.waitingForSeconds) {
                agg.longestWait = {
                    appointmentId: apt._id,
                    patientName: apt.patientId?.name || "Patient",
                    doctorName: apt.doctorId?.name || "Unassigned",
                    waitingForSeconds: waitSec,
                    queueStatus: apt.queueStatus || "waiting",
                    tokenNumber: apt.tokenNumber || "",
                };
            }

            const slotKey = `${apt.doctorId?.name || "Unassigned"}__${apt.timeSlot || "Unknown"}`;
            const slotData = agg.bottleneckMap.get(slotKey) || {
                doctorName: apt.doctorId?.name || "Unassigned",
                timeSlot: apt.timeSlot || "Unknown",
                totalAppointments: 0,
                waitingOrCalled: 0,
                totalWaitSeconds: 0,
            };
            slotData.totalAppointments += 1;
            if (waitSec > 0) {
                slotData.waitingOrCalled += 1;
                slotData.totalWaitSeconds += waitSec;
            }
            agg.bottleneckMap.set(slotKey, slotData);

            const notificationHistory = Array.isArray(
                apt.queueNotificationHistory,
            )
                ? apt.queueNotificationHistory
                : [];
            notificationHistory.forEach((item) => {
                agg.notificationsSent += 1;
                if (item.deliveryStatus === "delivered") {
                    agg.notificationsDelivered += 1;
                }
                if (item.channel === "email_and_in_app") {
                    agg.notificationsViaEmail += 1;
                }
                if (item.channel === "in_app_only") {
                    agg.notificationsInAppOnly += 1;
                }
            });
        };

        const qType = apt.queueType || "normal";
        updateAgg(aggregates.global);
        if (aggregates[qType]) {
            updateAgg(aggregates[qType]);
        }
    });

    const formatOutput = (agg) => {
        const bottlenecks = [...agg.bottleneckMap.values()]
            .map((item) => ({
                ...item,
                avgWaitSeconds:
                    item.waitingOrCalled > 0
                        ? Math.floor(
                              item.totalWaitSeconds / item.waitingOrCalled,
                          )
                        : 0,
            }))
            .sort((a, b) => {
                if (b.waitingOrCalled !== a.waitingOrCalled) {
                    return b.waitingOrCalled - a.waitingOrCalled;
                }
                return b.avgWaitSeconds - a.avgWaitSeconds;
            })
            .slice(0, 6);

        return {
            sla: {
                thresholdMinutes: 20,
                averageWaitSeconds:
                    agg.activeWaitCount > 0
                        ? Math.floor(agg.activeWaitTotal / agg.activeWaitCount)
                        : 0,
                breachCount: agg.slaBreaches,
                activeQueueCount: agg.activeWaitCount,
            },
            longestWaiting: agg.longestWait,
            bottlenecks,
            notificationDelivery: {
                sent: agg.notificationsSent,
                delivered: agg.notificationsDelivered,
                viaEmailAndInApp: agg.notificationsViaEmail,
                inAppOnly: agg.notificationsInAppOnly,
            },
        };
    };

    return {
        global: formatOutput(aggregates.global),
        ayurveda: formatOutput(aggregates.ayurveda),
        panchakarma: formatOutput(aggregates.panchakarma),
        normal: formatOutput(aggregates.normal),
    };
};

const getAppointmentAuditTrail = async (appointmentId) => {
    const appointment = await AppointmentModel.findById(appointmentId)
        .populate("patientId", "name")
        .populate("doctorId", "name");

    if (!appointment) {
        const err = new Error("Appointment not found");
        err.statusCode = 404;
        throw err;
    }

    const persistedTrail = Array.isArray(appointment.queueAuditTrail)
        ? appointment.queueAuditTrail
        : [];
    const synthesizedTrail = [];

    if (appointment.createdAt) {
        synthesizedTrail.push({
            at: appointment.createdAt,
            event: "appointment_created",
            fromStatus: null,
            toStatus: appointment.status,
            actorRole: "system",
            note: "Appointment created",
        });
    }
    if (appointment.adminApprovedAt) {
        synthesizedTrail.push({
            at: appointment.adminApprovedAt,
            event: "appointment_approved",
            fromStatus: "pending_admin_approval",
            toStatus: "confirmed",
            actorRole: "admin",
            note: appointment.adminNotes || "Approved by admin",
        });
    }
    if (appointment.firstCallEmailSentAt) {
        synthesizedTrail.push({
            at: appointment.firstCallEmailSentAt,
            event: "first_notification_sent",
            fromStatus: "waiting",
            toStatus: "called",
            actorRole: "system",
            note: "Initial notification sent",
        });
    }
    if (appointment.consultationStartedAt) {
        synthesizedTrail.push({
            at: appointment.consultationStartedAt,
            event: "consultation_started",
            fromStatus: "called",
            toStatus: "in_consultation",
            actorRole: "doctor",
            note: "Consultation started",
        });
    }
    if (appointment.consultationEndedAt) {
        synthesizedTrail.push({
            at: appointment.consultationEndedAt,
            event: "consultation_ended",
            fromStatus: "in_consultation",
            toStatus: appointment.queueStatus || "completed",
            actorRole: "doctor",
            note: "Consultation ended",
        });
    }

    const timeline = [...persistedTrail, ...synthesizedTrail]
        .filter((item) => item?.at)
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    const notificationHistory = Array.isArray(
        appointment.queueNotificationHistory,
    )
        ? appointment.queueNotificationHistory
        : [];

    return {
        appointment: {
            appointmentId: appointment._id,
            patientName: appointment.patientId?.name || "Patient",
            doctorName: appointment.doctorId?.name || "Doctor",
            date: appointment.date,
            timeSlot: appointment.timeSlot,
            tokenNumber: appointment.tokenNumber,
            queueStatus: appointment.queueStatus || "waiting",
            queueCallCount: Number(appointment.queueCallCount || 0),
        },
        timeline,
        notifications: notificationHistory,
    };
};

const batchDecideAppointments = async (adminUserId, payload = {}) => {
    const {
        appointmentIds = [],
        action,
        reason,
        reasonPreset,
        edits,
        adminNotes,
    } = payload;

    if (!Array.isArray(appointmentIds) || appointmentIds.length === 0) {
        const err = new Error("appointmentIds is required");
        err.statusCode = 400;
        throw err;
    }

    if (!["approve", "reject"].includes(action)) {
        const err = new Error("action must be approve or reject");
        err.statusCode = 400;
        throw err;
    }

    const resolvedReason = [reasonPreset, reason].filter(Boolean).join(" - ");
    const results = [];

    for (const appointmentId of appointmentIds) {
        try {
            if (action === "approve") {
                const approved = await approveAppointment(
                    appointmentId,
                    adminUserId,
                    edits || {},
                    adminNotes,
                );
                results.push({
                    appointmentId,
                    success: true,
                    action,
                    data: approved,
                });
            } else {
                const rejected = await rejectAppointment(
                    appointmentId,
                    adminUserId,
                    resolvedReason || "Rejected by admin batch action",
                );
                results.push({
                    appointmentId,
                    success: true,
                    action,
                    data: rejected,
                });
            }
        } catch (error) {
            results.push({
                appointmentId,
                success: false,
                action,
                message: error.message || "Failed to process appointment",
            });
        }
    }

    const successCount = results.filter((item) => item.success).length;
    return {
        action,
        total: appointmentIds.length,
        successCount,
        failureCount: appointmentIds.length - successCount,
        results,
    };
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
                const err = new Error(
                    "Selected doctor not found or not verified",
                );
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

    appendQueueAudit(appointment, {
        event: "appointment_approved",
        fromStatus: appointment.status,
        toStatus: "confirmed",
        actorRole: "admin",
        actorId: adminUserId,
        note: adminNotes || "Approved by admin",
    });

    await appointment.approveByAdmin(adminUserId, edits);

    const updatedAppointment = await AppointmentModel.findById(appointmentId)
        .populate("patientId", "name email")
        .populate("doctorId", "name");

    // Fire-and-forget email notification
    notifyAppointmentApproved(updatedAppointment.patientId.email, {
        doctorName: updatedAppointment.doctorId.name,
        date: updatedAppointment.date,
        timeSlot: updatedAppointment.timeSlot,
        wasEdited: !!edits,
        editedFields: updatedAppointment.adminEditedFields || [],
        adminNotes: adminNotes || updatedAppointment.adminNotes || "",
    });

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

    appendQueueAudit(appointment, {
        event: "appointment_rejected",
        fromStatus: appointment.status,
        toStatus: "rejected",
        actorRole: "admin",
        actorId: adminUserId,
        note: reason || "Rejected by admin",
    });

    await appointment.rejectByAdmin(adminUserId, reason);

    // Auto-refund if patient has paid
    const payment = await PaymentModel.findOne({
        appointmentId,
        status: "paid",
        refundStatus: "none",
    });

    if (payment) {
        try {
            const refund = await razorpay.payments.refund(
                payment.razorpayPaymentId,
                {
                    amount: payment.amount,
                    notes: {
                        reason: reason || "Appointment rejected by admin",
                        appointmentId: appointmentId.toString(),
                        adminId: adminUserId.toString(),
                    },
                },
            );
            payment.refundId = refund.id;
            payment.refundAmount = refund.amount;
            payment.refundStatus = "initiated";
            payment.refundReason = reason || "Appointment rejected by admin";
            payment.refundInitiatedAt = new Date();
            await payment.save();
            logger.info("Auto-refund initiated on rejection", {
                appointmentId,
                refundId: refund.id,
            });
        } catch (refundErr) {
            logger.error("Auto-refund failed on rejection", {
                appointmentId,
                error: refundErr.message,
            });
        }
    }

    // Fetch patient and doctor info for notification
    const [patientUser, doctorUser] = await Promise.all([
        UserModel.findById(appointment.patientId).select("email"),
        UserModel.findById(appointment.doctorId).select("name"),
    ]);

    // Fire-and-forget email notification
    notifyAppointmentRejected(patientUser.email, {
        doctorName: doctorUser?.name || "N/A",
        date: appointment.date,
        reason,
    });

    return {
        appointmentId: appointment._id,
        status: appointment.status,
        reason,
        refundInitiated: !!payment,
    };
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
        availability.availableDays =
            availableDays || availability.availableDays;
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

const normalizeDateInput = (dateLike) => {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) {
        const err = new Error("Invalid date");
        err.statusCode = 400;
        throw err;
    }
    date.setHours(0, 0, 0, 0);
    return date;
};

const normalizeSlotString = (slot) => {
    const value = String(slot || "").trim();
    if (!/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(value)) {
        const err = new Error(
            "Invalid slot format. Expected HH:mm - HH:mm, e.g. 09:00 - 10:00",
        );
        err.statusCode = 400;
        throw err;
    }
    return value;
};

const sortSlotStrings = (slots = []) =>
    [...slots].sort((a, b) => String(a).localeCompare(String(b)));

const ensureDoctorExistsForAvailability = async (doctorId) => {
    const doctor = await DoctorModel.findOne({
        userId: doctorId,
        isVerified: true,
    });
    if (!doctor) {
        const err = new Error("Doctor not found or not verified");
        err.statusCode = 404;
        throw err;
    }
};

const getOrCreateAvailabilityForDoctor = async (doctorId, adminUserId) => {
    let availability = await DoctorAvailabiltyModel.findOne({ doctorId });
    if (!availability) {
        availability = await DoctorAvailabiltyModel.create({
            doctorId,
            availableDays: [],
            timeSlots: {},
            unavailableDates: [],
            dateSpecificSlots: [],
            setByAdmin: adminUserId,
            lastUpdatedBy: adminUserId,
        });
    }
    return availability;
};

const ensureFutureDate = (date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) {
        const err = new Error("You can only manage upcoming dates");
        err.statusCode = 400;
        throw err;
    }
};

const ensureAdminSlotRemovalAllowed = async ({ doctorId, date, slot }) => {
    const now = Date.now();
    const diffMs = date.getTime() - now;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    if (diffMs < sevenDaysMs) {
        const err = new Error(
            "Slot can only be removed if appointment date is at least 7 days away",
        );
        err.statusCode = 400;
        throw err;
    }

    const { start: dayStart, end: dayEnd } = getISTDayBounds(date);
    const bookedCount = await AppointmentModel.countDocuments({
        doctorId,
        date: { $gte: dayStart, $lte: dayEnd },
        timeSlot: slot,
        status: { $nin: ["cancelled", "rejected"] },
    });

    if (bookedCount > 0) {
        const err = new Error(
            "Cannot remove this slot because at least one patient is already booked",
        );
        err.statusCode = 400;
        throw err;
    }
};

const getDoctorAvailabilityForAdmin = async (doctorId, date) => {
    await ensureDoctorExistsForAvailability(doctorId);
    const availability = await DoctorAvailabiltyModel.findOne({ doctorId });

    if (!availability) {
        return {
            availableDays: [],
            timeSlots: {},
            unavailableDates: [],
            dateSpecificSlots: [],
            dateView: date
                ? {
                      date,
                      slots: [],
                      source: "none",
                  }
                : null,
        };
    }

    if (!date) {
        return availability;
    }

    const selectedDate = normalizeDateInput(date);
    const selectedDateKey = getISTDateKey(selectedDate);
    const dateOverride = (availability.dateSpecificSlots || []).find(
        (entry) => getISTDateKey(entry.date) === selectedDateKey,
    );

    return {
        ...availability.toObject(),
        dateView: {
            date: selectedDate,
            slots: availability.getAvailableSlotsForDate(selectedDate),
            source: dateOverride ? "date_specific" : "weekly",
        },
    };
};

const setDoctorAvailabilityForDateByAdmin = async (
    doctorId,
    adminUserId,
    payload,
) => {
    await ensureDoctorExistsForAvailability(doctorId);
    const selectedDate = normalizeDateInput(payload?.date);
    ensureFutureDate(selectedDate);

    const nextSlots = sortSlotStrings(
        [...new Set((payload?.slots || []).map(normalizeSlotString))],
    );

    const availability = await getOrCreateAvailabilityForDoctor(
        doctorId,
        adminUserId,
    );
    const existingSlots = availability.getAvailableSlotsForDate(selectedDate);
    const toRemove = existingSlots.filter((slot) => !nextSlots.includes(slot));

    for (const slot of toRemove) {
        await ensureAdminSlotRemovalAllowed({
            doctorId,
            date: selectedDate,
            slot,
        });
    }

    availability.dateSpecificSlots = Array.isArray(availability.dateSpecificSlots)
        ? availability.dateSpecificSlots
        : [];

    const selectedDateKey = getISTDateKey(selectedDate);
    const index = availability.dateSpecificSlots.findIndex(
        (entry) => getISTDateKey(entry.date) === selectedDateKey,
    );

    const entry = {
        date: selectedDate,
        slots: nextSlots,
        updatedBy: adminUserId,
        updatedAt: new Date(),
    };

    if (index >= 0) {
        availability.dateSpecificSlots[index] = entry;
    } else {
        availability.dateSpecificSlots.push(entry);
    }

    availability.setByAdmin = adminUserId;
    availability.lastUpdatedBy = adminUserId;
    await availability.save();

    return {
        doctorId,
        date: selectedDate,
        slots: nextSlots,
        source: "date_specific",
    };
};

const addDoctorAvailabilitySlotForDateByAdmin = async (
    doctorId,
    adminUserId,
    payload,
) => {
    await ensureDoctorExistsForAvailability(doctorId);
    const selectedDate = normalizeDateInput(payload?.date);
    ensureFutureDate(selectedDate);
    const slot = normalizeSlotString(payload?.slot);

    const availability = await getOrCreateAvailabilityForDoctor(
        doctorId,
        adminUserId,
    );
    const currentSlots = availability.getAvailableSlotsForDate(selectedDate);
    const merged = sortSlotStrings([...new Set([...currentSlots, slot])]);

    return setDoctorAvailabilityForDateByAdmin(doctorId, adminUserId, {
        date: selectedDate,
        slots: merged,
    });
};

const removeDoctorAvailabilitySlotForDateByAdmin = async (
    doctorId,
    adminUserId,
    payload,
) => {
    await ensureDoctorExistsForAvailability(doctorId);
    const selectedDate = normalizeDateInput(payload?.date);
    ensureFutureDate(selectedDate);
    const slot = normalizeSlotString(payload?.slot);

    await ensureAdminSlotRemovalAllowed({
        doctorId,
        date: selectedDate,
        slot,
    });

    const availability = await getOrCreateAvailabilityForDoctor(
        doctorId,
        adminUserId,
    );
    const currentSlots = availability.getAvailableSlotsForDate(selectedDate);
    const nextSlots = currentSlots.filter((item) => item !== slot);

    return setDoctorAvailabilityForDateByAdmin(doctorId, adminUserId, {
        date: selectedDate,
        slots: nextSlots,
    });
};

const getVerifiedDoctorsForAdmin = async (query = {}) => {
    const { page, limit, skip } = parsePagination(query);
    const doctorQuery = { isVerified: true };

    if (query.specialization) {
        const escaped = query.specialization.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
        );
        doctorQuery.specialization = {
            $regex: new RegExp(`^${escaped}$`, "i"),
        };
    }

    const [doctors, totalCount] = await Promise.all([
        DoctorModel.find(doctorQuery).skip(skip).limit(limit),
        DoctorModel.countDocuments(doctorQuery),
    ]);

    const doctorUserIds = doctors.map((d) => d.userId.toString());

    const fallbackDoctorRefs = await DoctorModel.find({
        _id: { $in: doctorUserIds },
    })
        .select("_id userId")
        .lean();

    const fallbackDoctorRefMap = new Map(
        fallbackDoctorRefs.map((d) => [d._id.toString(), d.userId.toString()]),
    );

    const resolvedUserIds = doctorUserIds.map(
        (id) => fallbackDoctorRefMap.get(id) || id,
    );

    const users = await UserModel.find({
        _id: { $in: [...new Set(resolvedUserIds)] },
    }).select("name email phone gender profilePhoto isActive");
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const doctorList = doctors
        .map((doc) => {
            const resolvedUserId =
                fallbackDoctorRefMap.get(doc.userId.toString()) ||
                doc.userId.toString();
            const user = userMap.get(resolvedUserId);
            if (!user) return null;

            return {
                doctorId: doc.userId,
                name: user.name,
                email: user.email,
                phone: user.phone,
                gender: user.gender,
                profilePhoto: user.profilePhoto,
                isActive: !!user.isActive,
                status: user.isActive ? "active" : "inactive",
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

const getDoctorAvailableSlotsForAdmin = async (doctorId, date) => {
    if (!date) {
        const err = new Error("date query parameter is required");
        err.statusCode = 400;
        throw err;
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

const offlineBookAppointment = async (adminId, bookingData) => {
    const {
        patientEmail,
        doctorId,
        date,
        timeSlot,
        symptoms,
        urgencyLevel,
        adminNotes,
        isEmergencyTriage,
        emergencyPatientName,
        emergencyPatientPhone,
        emergencyConditionSummary,
        emergencyWardLocation,
    } = bookingData;

    const doctor = await DoctorModel.findOne({
        userId: doctorId,
        isVerified: true,
    });

    if (!doctor) {
        const err = new Error("Doctor not found or not verified");
        err.statusCode = 404;
        throw err;
    }

    const emergencyMode = !!isEmergencyTriage;
    let patientUser = null;

    if (!emergencyMode) {
        patientUser = await UserModel.findOne({ email: patientEmail });
        if (!patientUser) {
            const err = new Error("Patient not found with this email");
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
    }

    const session = await mongoose.startSession();
    let appointment;

    try {
        await session.withTransaction(async () => {
            const appointmentDate = emergencyMode ? new Date() : new Date(date);
            const slotLabel = emergencyMode
                ? "EMERGENCY - IMMEDIATE"
                : timeSlot;

            let patient = null;
            let emergencyPatient = null;

            if (emergencyMode) {
                const createdEmergencyPatients =
                    await EmergencyPatientModel.create(
                        [
                            {
                                displayName: emergencyPatientName,
                                phone: emergencyPatientPhone || "",
                                conditionSummary:
                                    emergencyConditionSummary ||
                                    "Unconscious / critical condition",
                                wardLocation:
                                    emergencyWardLocation || "Emergency Ward",
                                createdByAdminId: adminId,
                            },
                        ],
                        { session },
                    );
                emergencyPatient = createdEmergencyPatients[0];
            } else {
                patient = await PatientModel.findOne(
                    { userId: patientUser._id },
                    null,
                    { session },
                );

                if (!patient) {
                    const createdPatients = await PatientModel.create(
                        [
                            {
                                userId: patientUser._id,
                                bloodGroup: null,
                                medicalHistory: [],
                                allergies: [],
                                emergencyContact: {},
                            },
                        ],
                        { session },
                    );
                    patient = createdPatients[0];
                }
            }

            const createdAppointments = await AppointmentModel.create(
                [
                    {
                        patientId: patient?._id || null,
                        emergencyPatientId: emergencyPatient?._id || null,
                        doctorId,
                        date: appointmentDate,
                        timeSlot: slotLabel,
                        status: "confirmed",
                        urgencyLevel: emergencyMode
                            ? "emergency"
                            : urgencyLevel || "normal",
                        symptoms: symptoms || [],
                        aiSummary: emergencyMode
                            ? `**Emergency Triage Booking**\n\nCondition: ${emergencyConditionSummary || "Unconscious / critical condition"}\n\nWard: ${emergencyWardLocation || "Emergency Ward"}\n\nImmediate priority assigned by admin.`
                            : symptoms
                              ? `**Walk-in Patient**\n\nSymptoms: ${symptoms.join(", ")}\n\nBooked by admin (offline).`
                              : "Walk-in patient. Booked by admin (offline).",
                        adminApprovedBy: adminId,
                        adminApprovedAt: new Date(),
                        adminNotes:
                            adminNotes ||
                            (emergencyMode
                                ? "Emergency triage booking by admin"
                                : "Offline booking by admin"),
                        queueStatus: emergencyMode ? "called" : "waiting",
                        queueNotificationMessage: emergencyMode
                            ? "Immediate Priority - Doctor report to emergency ward"
                            : "",
                        emergencyMetadata: {
                            isEmergencyTriage: emergencyMode,
                            immediatePriority: emergencyMode,
                            wardLocation: emergencyWardLocation || "",
                        },
                        originalBooking: {
                            doctorId,
                            date: appointmentDate,
                            timeSlot: slotLabel,
                        },
                    },
                ],
                { session },
            );
            appointment = createdAppointments[0];

            const queueDate = getISTDateKey(appointmentDate);
            appointment.queueDate = queueDate;

            if (emergencyMode) {
                appointment.tokenSequence = 0;
                appointment.tokenNumber = `EMR-${Date.now()}`;
            } else {
                const queueType = appointment.queueType || "normal";
                const tokenDoc = await QueueTokenModel.findOneAndUpdate(
                    { queueDate, doctorId, queueType },
                    { $inc: { lastSequence: 1 } },
                    { upsert: true, new: true, session },
                );

                appointment.tokenSequence = tokenDoc.lastSequence;
                appointment.tokenNumber = generateTokenNumber(
                    queueDate,
                    doctorId,
                    tokenDoc.lastSequence,
                );
            }

            await appointment.save({ session });
        });
    } finally {
        await session.endSession();
    }

    const doctorUser = await UserModel.findById(doctorId).select("name");

    return {
        appointmentId: appointment._id,
        status: appointment.status,
        patient: emergencyMode
            ? emergencyPatientName
            : patientUser?.name || "Patient",
        doctor: doctorUser.name,
        specialization: doctor.specialization,
        date: appointment.date,
        timeSlot: appointment.timeSlot,
        immediatePriority: emergencyMode,
    };
};

const getEmergencyDelays = async () => {
    const doctors = await DoctorModel.find({
        "emergencyState.isActive": true,
    }).populate("userId", "name");

    return doctors.map((doc) => ({
        doctorId: doc.userId._id, // or doc._id, depending on FE usage, let's stick to user ID or doctor internal ID
        doctorName: doc.userId.name,
        reason: doc.emergencyState.reason,
        activatedAt: doc.emergencyState.activatedAt,
    }));
};

module.exports = {
    getDashboardStats,
    createDoctorAccountByAdmin,
    getPendingDoctorApplications,
    approveDoctorApplication,
    rejectDoctorApplication,
    getPendingNormalAppointments,
    getEmergencyAppointments,
    approveAppointment,
    rejectAppointment,
    setDoctorAvailability,
    offlineBookAppointment,
    getVerifiedDoctorsForAdmin,
    getDoctorAvailableSlotsForAdmin,
    getDoctorAvailabilityForAdmin,
    getTodayQueue,
    callTodayQueuePatient,
    getQueueInsights,
    getAppointmentAuditTrail,
    batchDecideAppointments,
    getEmergencyDelays,
    setDoctorAvailabilityForDateByAdmin,
    addDoctorAvailabilitySlotForDateByAdmin,
    removeDoctorAvailabilitySlotForDateByAdmin,
};
