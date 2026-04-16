const { AppointmentModel } = require("../../../models/appointmentSchema");
const { ChatHistoryModel } = require("../../../models/chatHistorySchema");
const { DoctorModel } = require("../../../models/doctorSchema");
const {
    DoctorAvailabiltyModel,
} = require("../../../models/doctorAvailabilitySchema");
const { PatientModel } = require("../../../models/patientSchema");
const { QueueTokenModel } = require("../../../models/queueTokenSchema");
const { UserModel } = require("../../../models/userSchema");
const {
    calculateAge,
    parsePagination,
    generateTokenNumber,
    getISTDateKey,
    getISTDayBounds,
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

    // Reconcile stale state from older records.
    if (appointment.status === "completed") {
        queueStatus = "completed";
    } else if (
        appointment.consultationStartedAt &&
        !appointment.consultationEndedAt
    ) {
        queueStatus = "in_consultation";
    } else if (
        (queueStatus === "waiting" || !queueStatus) &&
        (appointment.lastCalledAt || appointment.firstCallEmailSentAt)
    ) {
        queueStatus = "called";
    }

    if (!queueStatus) {
        if (appointment.status === "completed") {
            queueStatus = "completed";
        } else if (
            appointment.consultationStartedAt &&
            !appointment.consultationEndedAt
        ) {
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

    if (queueStatus === "called" && queueCallCount <= 0) {
        queueCallCount = 1;
    }

    return {
        queueStatus,
        queueCallCount,
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

const getPatientDisplayData = (appointment) => {
    if (appointment?.patientId) {
        return {
            id: appointment.patientId._id,
            name: appointment.patientId.name || "Patient",
            email: appointment.patientId.email,
            phone: appointment.patientId.phone,
            gender: appointment.patientId.gender,
            age: calculateAge(appointment.patientId.dob),
            profilePhoto: appointment.patientId.profilePhoto,
            isEmergencyTriage: false,
        };
    }

    if (appointment?.emergencyPatientId) {
        return {
            id: appointment.emergencyPatientId._id,
            name:
                appointment.emergencyPatientId.displayName ||
                "Emergency Patient",
            email: null,
            phone: appointment.emergencyPatientId.phone || "",
            gender: null,
            age: null,
            profilePhoto: null,
            isEmergencyTriage: true,
            conditionSummary:
                appointment.emergencyPatientId.conditionSummary || "",
            wardLocation: appointment.emergencyPatientId.wardLocation || "",
        };
    }

    return {
        id: null,
        name: "Patient",
        email: null,
        phone: "",
        gender: null,
        age: null,
        profilePhoto: null,
        isEmergencyTriage: false,
    };
};

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

const SLOT_CAPACITY = 2;

const buildSlotCountMap = (appointments) => {
    const map = {};
    appointments.forEach((apt) => {
        const key = `${(apt.doctorId?._id || apt.doctorId).toString()}__${apt.timeSlot}`;
        map[key] = (map[key] || 0) + 1;
    });
    return map;
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

    const { start: todayStart, end: todayEnd } = getISTDayBounds();

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
            .populate("emergencyPatientId", "displayName")
            .sort({ timeSlot: 1, createdAt: 1 })
            .limit(10),
    ]);

    const totalPatients = totalPatientsAgg[0]?.count || 0;
    const normalizedTodayAppointments = await Promise.all(
        todayAppointmentsDocs.map(assignTokenIfMissing),
    );
    const sortedTodayAppointments = [...normalizedTodayAppointments].sort(
        (a, b) => {
            const aEmergencyScore =
                a?.emergencyMetadata?.immediatePriority ||
                a?.emergencyMetadata?.isEmergencyTriage ||
                a?.urgencyLevel === "emergency"
                    ? 1
                    : 0;
            const bEmergencyScore =
                b?.emergencyMetadata?.immediatePriority ||
                b?.emergencyMetadata?.isEmergencyTriage ||
                b?.urgencyLevel === "emergency"
                    ? 1
                    : 0;

            if (aEmergencyScore !== bEmergencyScore) {
                return bEmergencyScore - aEmergencyScore;
            }

            const aSeq = Number.isFinite(Number(a?.tokenSequence))
                ? Number(a.tokenSequence)
                : Number.MAX_SAFE_INTEGER;
            const bSeq = Number.isFinite(Number(b?.tokenSequence))
                ? Number(b.tokenSequence)
                : Number.MAX_SAFE_INTEGER;
            if (aSeq !== bSeq) return aSeq - bSeq;

            return String(a?.timeSlot || "").localeCompare(
                String(b?.timeSlot || ""),
            );
        },
    );

    const slotCountMap = buildSlotCountMap(sortedTodayAppointments);

    const todayAppointments = sortedTodayAppointments.map((apt) => ({
        ...(() => {
            const patient = getPatientDisplayData(apt);
            const slotKey = `${userId.toString()}__${apt.timeSlot}`;
            return {
                appointmentId: apt._id,
                patient: {
                    id: patient.id,
                    name: patient.name,
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
                consultationDurationSeconds:
                    getConsultationDurationSeconds(apt),
                isEmergencyTriage: patient.isEmergencyTriage,
                slotBookingCount: slotCountMap[slotKey] || 1,
                slotCapacity: SLOT_CAPACITY,
            };
        })(),
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
        emergencyState: doctor.emergencyState,
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
        const { start: dayStart, end: dayEnd } = getISTDayBounds(date);
        query.date = {
            $gte: dayStart,
            $lte: dayEnd,
        };
    }

    const [appointments, totalCount] = await Promise.all([
        AppointmentModel.find(query)
            .populate("patientId", "name email phone gender dob profilePhoto")
            .populate(
                "emergencyPatientId",
                "displayName phone conditionSummary wardLocation",
            )
            .sort({ date: 1, timeSlot: 1 })
            .skip(skip)
            .limit(limit),
        AppointmentModel.countDocuments(query),
    ]);

    // Batch fetch all patient profiles in one query instead of N+1
    const patientUserIds = appointments
        .map((apt) => apt.patientId?._id)
        .filter(Boolean);
    const patientProfiles = await PatientModel.find({
        userId: { $in: patientUserIds },
    }).select("userId bloodGroup allergies medicalHistory");
    const profileMap = new Map(
        patientProfiles.map((p) => [p.userId.toString(), p]),
    );

    const appointmentsWithDetails = appointments.map((apt) => {
        const patientData = getPatientDisplayData(apt);
        const patientProfile = patientData.id
            ? profileMap.get(String(patientData.id))
            : null;
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
                id: patientData.id,
                name: patientData.name,
                email: patientData.email,
                phone: patientData.phone,
                gender: patientData.gender,
                age: patientData.age,
                profilePhoto: patientData.profilePhoto,
                bloodGroup: patientProfile?.bloodGroup,
                allergies: patientProfile?.allergies || [],
                isEmergencyTriage: patientData.isEmergencyTriage,
                wardLocation: patientData.wardLocation,
                conditionSummary: patientData.conditionSummary,
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
    const { start: todayStart, end: todayEnd } = getISTDayBounds();

    const appointments = await AppointmentModel.find({
        doctorId: userId,
        status: { $nin: ["rejected"] },
        date: { $gte: todayStart, $lte: todayEnd },
    })
        .populate("patientId", "name email phone gender dob profilePhoto")
        .populate(
            "emergencyPatientId",
            "displayName phone conditionSummary wardLocation",
        )
        .sort({ timeSlot: 1 });

    const normalizedAppointments = await Promise.all(
        appointments.map(assignTokenIfMissing),
    );

    // Batch fetch all patient profiles in one query
    const patientUserIds = normalizedAppointments
        .map((apt) => apt.patientId?._id)
        .filter(Boolean);
    const patientProfiles = await PatientModel.find({
        userId: { $in: patientUserIds },
    }).select("userId bloodGroup allergies emergencyContact");
    const profileMap = new Map(
        patientProfiles.map((p) => [p.userId.toString(), p]),
    );

    const slotCountMap = buildSlotCountMap(normalizedAppointments);

    const appointmentsWithDetails = normalizedAppointments.map((apt) => {
        const patientData = getPatientDisplayData(apt);
        const patientProfile = patientData.id
            ? profileMap.get(String(patientData.id))
            : null;
        const derivedQueue = deriveQueueMeta(apt);
        const doctorIdStr = (apt.doctorId?._id || apt.doctorId).toString();
        const slotKey = `${doctorIdStr}__${apt.timeSlot}`;

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
                id: patientData.id,
                name: patientData.name,
                phone: patientData.phone,
                gender: patientData.gender,
                age: patientData.age,
                bloodGroup: patientProfile?.bloodGroup,
                allergies: patientProfile?.allergies || [],
                emergencyContact: patientProfile?.emergencyContact,
                isEmergencyTriage: patientData.isEmergencyTriage,
                wardLocation: patientData.wardLocation,
                conditionSummary: patientData.conditionSummary,
            },
            symptoms: apt.symptoms,
            aiSummary: apt.aiSummary,
            isEmergency: apt.urgencyLevel === "emergency",
            slotBookingCount: slotCountMap[slotKey] || 1,
            slotCapacity: SLOT_CAPACITY,
        };
    });

    const doctor = await DoctorModel.findOne({ userId });

    return {
        date: getISTDateKey(new Date()),
        totalCount: appointmentsWithDetails.length,
        emergencyState: doctor?.emergencyState,
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

const updateQueueCallState = async (appointment, doctorName, doctorUserId) => {
    const firstCall = !appointment.firstCallEmailSentAt;
    const canEmailPatient = !!appointment.patientId?.email;
    const now = new Date();
    const previousQueueStatus = appointment.queueStatus || "waiting";

    appointment.queueStatus = "called";
    appointment.queueCallCount = (appointment.queueCallCount || 0) + 1;
    appointment.lastCalledAt = now;
    appointment.queueNotificationMessage = firstCall
        ? "Please proceed to consultation area."
        : "Reminder: Your consultation turn is active.";

    if (firstCall) {
        appointment.firstCallEmailSentAt = now;
        if (canEmailPatient) {
            notifyPatientTurnCalled(appointment.patientId.email, {
                patientName: appointment.patientId?.name,
                doctorName: doctorName || "Doctor",
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
        channel:
            firstCall && canEmailPatient ? "email_and_in_app" : "in_app_only",
        deliveryStatus: "delivered",
        actorRole: "doctor",
        actorId: doctorUserId,
        message: appointment.queueNotificationMessage,
    });

    appendQueueAudit(appointment, {
        event: firstCall ? "patient_notified" : "patient_reminded",
        fromStatus: previousQueueStatus,
        toStatus: "called",
        actorRole: "doctor",
        actorId: doctorUserId,
        note: firstCall
            ? "Doctor sent first notification (email + in-app)."
            : "Doctor sent reminder notification (in-app).",
    });

    await appointment.save();

    return {
        appointmentId: appointment._id,
        queueStatus: appointment.queueStatus,
        queueCallCount: appointment.queueCallCount,
        firstCallEmailSent: firstCall,
        notificationMode:
            firstCall && canEmailPatient ? "email_and_in_app" : "in_app_only",
        tokenNumber: appointment.tokenNumber,
    };
};

const callTodayQueuePatient = async (userId, appointmentId) => {
    const { start: todayStart, end: todayEnd } = getISTDayBounds();

    const [appointment, doctor] = await Promise.all([
        AppointmentModel.findOne({
            _id: appointmentId,
            doctorId: userId,
            status: "confirmed",
            date: { $gte: todayStart, $lte: todayEnd },
        })
            .populate("patientId", "name email")
            .populate("emergencyPatientId", "displayName"),
        UserModel.findById(userId).select("name"),
    ]);

    if (!appointment) {
        const err = new Error("Today's confirmed appointment not found");
        err.statusCode = 404;
        throw err;
    }

    await assignTokenIfMissing(appointment);
    return updateQueueCallState(appointment, doctor?.name, userId);
};

const callNextQueuePatient = async (userId) => {
    const { start: todayStart, end: todayEnd } = getISTDayBounds();

    const [doctor, appointments] = await Promise.all([
        UserModel.findById(userId).select("name"),
        AppointmentModel.find({
            doctorId: userId,
            status: "confirmed",
            date: { $gte: todayStart, $lte: todayEnd },
        })
            .populate("patientId", "name email")
            .populate("emergencyPatientId", "displayName")
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

    return updateQueueCallState(nextAppointment, doctor?.name, userId);
};

const startConsultation = async (userId, appointmentId) => {
    const { start: todayStart, end: todayEnd } = getISTDayBounds();

    const appointment = await AppointmentModel.findOne({
        _id: appointmentId,
        doctorId: userId,
        status: "confirmed",
        date: { $gte: todayStart, $lte: todayEnd },
    })
        .populate("patientId", "name")
        .populate("emergencyPatientId", "displayName");

    if (!appointment) {
        const err = new Error("Today's confirmed appointment not found");
        err.statusCode = 404;
        throw err;
    }

    await assignTokenIfMissing(appointment);
    const previousQueueStatus = appointment.queueStatus || "called";
    appointment.queueStatus = "in_consultation";
    appointment.queueNotificationMessage = "You are currently in consultation.";
    if (!appointment.consultationStartedAt) {
        appointment.consultationStartedAt = new Date();
    }
    appointment.consultationEndedAt = null;
    appointment.consultationDurationSeconds = null;
    appendQueueAudit(appointment, {
        event: "consultation_started",
        fromStatus: previousQueueStatus,
        toStatus: "in_consultation",
        actorRole: "doctor",
        actorId: userId,
        note: "Consultation started by doctor",
    });
    await appointment.save();

    return {
        appointmentId: appointment._id,
        queueStatus: appointment.queueStatus,
        patientName:
            appointment.patientId?.name ||
            appointment.emergencyPatientId?.displayName ||
            "Patient",
        tokenNumber: appointment.tokenNumber,
        consultationStartedAt: appointment.consultationStartedAt,
    };
};

const getAppointmentDetail = async (userId, appointmentId) => {
    const appointment = await AppointmentModel.findOne({
        _id: appointmentId,
        doctorId: userId,
    })
        .populate("patientId", "name email phone gender dob profilePhoto")
        .populate(
            "emergencyPatientId",
            "displayName phone conditionSummary wardLocation",
        );

    if (!appointment) {
        const err = new Error("Appointment not found");
        err.statusCode = 404;
        throw err;
    }

    const patientProfile = appointment.patientId
        ? await PatientModel.findOne({
              userId: appointment.patientId._id,
          })
        : null;

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
            id:
                appointment.patientId?._id ||
                appointment.emergencyPatientId?._id ||
                null,
            name:
                appointment.patientId?.name ||
                appointment.emergencyPatientId?.displayName ||
                "Patient",
            email: appointment.patientId?.email,
            phone:
                appointment.patientId?.phone ||
                appointment.emergencyPatientId?.phone ||
                "",
            gender: appointment.patientId?.gender || null,
            age: appointment.patientId
                ? calculateAge(appointment.patientId.dob)
                : null,
            profilePhoto: appointment.patientId?.profilePhoto,
            bloodGroup: patientProfile?.bloodGroup,
            allergies: patientProfile?.allergies || [],
            medicalHistory: patientProfile?.medicalHistory || [],
            emergencyContact: patientProfile?.emergencyContact,
            isEmergencyTriage: !appointment.patientId,
            wardLocation: appointment.emergencyPatientId?.wardLocation,
            conditionSummary: appointment.emergencyPatientId?.conditionSummary,
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
    const previousQueueStatus = appointment.queueStatus || "in_consultation";
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
    appendQueueAudit(appointment, {
        event: "consultation_completed",
        fromStatus: previousQueueStatus,
        toStatus: "completed",
        actorRole: "doctor",
        actorId: userId,
        note: "Consultation completed by doctor",
    });
    await appointment.save();

    // Fetch patient and doctor info for notification
    const doctorUser = await UserModel.findById(userId).select("name");
    if (appointment.patientId) {
        const patientUser = await UserModel.findById(
            appointment.patientId,
        ).select("email");
        if (patientUser?.email) {
            notifyAppointmentCompleted(patientUser.email, {
                doctorName: doctorUser.name,
                date: appointment.date,
                hasPrescription: !!prescription,
            });
        }
    }

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

const activateEmergencyDelay = async (userId, reason) => {
    const doctor = await DoctorModel.findOneAndUpdate(
        { userId },
        {
            $set: {
                "emergencyState.isActive": true,
                "emergencyState.reason": reason || "Handling a critical case",
                "emergencyState.activatedAt": new Date(),
            },
        },
        { new: true },
    );

    if (!doctor) {
        const err = new Error("Doctor profile not found");
        err.statusCode = 404;
        throw err;
    }

    return doctor.emergencyState;
};

const deactivateEmergencyDelay = async (userId) => {
    const doctor = await DoctorModel.findOneAndUpdate(
        { userId },
        {
            $set: {
                "emergencyState.isActive": false,
                "emergencyState.reason": "",
                "emergencyState.activatedAt": null,
            },
        },
        { new: true },
    );

    if (!doctor) {
        const err = new Error("Doctor profile not found");
        err.statusCode = 404;
        throw err;
    }

    return doctor.emergencyState;
};

const getCustomReferences = async (userId) => {
    const doctor = await DoctorModel.findOne({ userId }).select("customReferences specialization");
    if (!doctor) {
        const err = new Error("Doctor profile not found");
        err.statusCode = 404;
        throw err;
    }
    return doctor.customReferences || { medications: [], procedures: [], bestPractices: [] };
};

const addCustomReference = async (userId, activeTab, itemPayload) => {
    const doctor = await DoctorModel.findOne({ userId });
    if (!doctor) {
        const err = new Error("Doctor profile not found");
        err.statusCode = 404;
        throw err;
    }

    const currentRefs = doctor.customReferences || { medications: [], procedures: [], bestPractices: [] };
    
    // Ensure the structure exists
    const specialization = doctor.specialization || "General";
    if (!currentRefs[specialization]) {
        currentRefs[specialization] = { medications: [], procedures: [], bestPractices: [] };
    }
    if (!currentRefs[specialization][activeTab]) {
        currentRefs[specialization][activeTab] = [];
    }

    currentRefs[specialization][activeTab].push(itemPayload);
    
    // Using markModified since the customReferences type is Mixed
    doctor.customReferences = currentRefs;
    doctor.markModified('customReferences');
    await doctor.save();
    
    return currentRefs;
};

const getUpcomingAppointments = async (userId) => {
    const { end: todayEnd } = getISTDayBounds();

    const appointments = await AppointmentModel.find({
        doctorId: userId,
        status: { $nin: ["rejected", "cancelled"] },
        date: { $gt: todayEnd },
    })
        .populate("patientId", "name email phone profilePhoto")
        .sort({ date: 1, timeSlot: 1 })
        .limit(20);

    return appointments.map((apt) => ({
        appointmentId: apt._id,
        patient: {
            id: apt.patientId?._id,
            name: apt.patientId?.name || "Patient",
            email: apt.patientId?.email,
            phone: apt.patientId?.phone,
        },
        date: apt.date,
        timeSlot: apt.timeSlot,
        status: apt.status,
        urgencyLevel: apt.urgencyLevel,
    }));
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

const getOrCreateAvailability = async (userId) => {
    let availability = await DoctorAvailabiltyModel.findOne({ doctorId: userId });
    if (!availability) {
        availability = await DoctorAvailabiltyModel.create({
            doctorId: userId,
            availableDays: [],
            timeSlots: {},
            unavailableDates: [],
            dateSpecificSlots: [],
            lastUpdatedBy: userId,
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

const ensureSlotRemovalAllowed = async ({
    userId,
    date,
    slot,
}) => {
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
        doctorId: userId,
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

const getOwnAvailability = async (userId, date) => {
    const availability = await DoctorAvailabiltyModel.findOne({ doctorId: userId });
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

const updateOwnAvailability = async (userId, updateData) => {
    const availability = await getOrCreateAvailability(userId);

    if (updateData.availableDays !== undefined) {
        availability.availableDays = updateData.availableDays;
    }
    if (updateData.timeSlots) {
        availability.timeSlots = updateData.timeSlots;
    }
    if (updateData.unavailableDates) {
        availability.unavailableDates = updateData.unavailableDates;
    }

    availability.lastUpdatedBy = userId;
    await availability.save();
    return availability;
};

const setOwnAvailabilityForDate = async (userId, payload) => {
    const selectedDate = normalizeDateInput(payload?.date);
    ensureFutureDate(selectedDate);

    const nextSlots = sortSlotStrings(
        [...new Set((payload?.slots || []).map(normalizeSlotString))],
    );

    const availability = await getOrCreateAvailability(userId);
    const existingSlots = availability.getAvailableSlotsForDate(selectedDate);
    const toRemove = existingSlots.filter((slot) => !nextSlots.includes(slot));

    for (const slot of toRemove) {
        await ensureSlotRemovalAllowed({
            userId,
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
        updatedBy: userId,
        updatedAt: new Date(),
    };

    if (index >= 0) {
        availability.dateSpecificSlots[index] = entry;
    } else {
        availability.dateSpecificSlots.push(entry);
    }

    availability.lastUpdatedBy = userId;
    await availability.save();

    return {
        date: selectedDate,
        slots: nextSlots,
        source: "date_specific",
    };
};

const addOwnAvailabilitySlotForDate = async (userId, payload) => {
    const selectedDate = normalizeDateInput(payload?.date);
    ensureFutureDate(selectedDate);
    const slot = normalizeSlotString(payload?.slot);

    const availability = await getOrCreateAvailability(userId);
    const currentSlots = availability.getAvailableSlotsForDate(selectedDate);
    const merged = sortSlotStrings([...new Set([...currentSlots, slot])]);

    return setOwnAvailabilityForDate(userId, {
        date: selectedDate,
        slots: merged,
    });
};

const removeOwnAvailabilitySlotForDate = async (userId, payload) => {
    const selectedDate = normalizeDateInput(payload?.date);
    ensureFutureDate(selectedDate);
    const slot = normalizeSlotString(payload?.slot);

    await ensureSlotRemovalAllowed({
        userId,
        date: selectedDate,
        slot,
    });

    const availability = await getOrCreateAvailability(userId);
    const currentSlots = availability.getAvailableSlotsForDate(selectedDate);
    const nextSlots = currentSlots.filter((item) => item !== slot);

    return setOwnAvailabilityForDate(userId, {
        date: selectedDate,
        slots: nextSlots,
    });
};

module.exports = {
    getDoctorDashboard,
    getDoctorAppointments,
    getTodayAppointments,
    getUpcomingAppointments,
    getOwnAvailability,
    updateOwnAvailability,
    setOwnAvailabilityForDate,
    addOwnAvailabilitySlotForDate,
    removeOwnAvailabilitySlotForDate,
    getAppointmentDetail,
    completeAppointment,
    callTodayQueuePatient,
    callNextQueuePatient,
    startConsultation,
    getDoctorProfile,
    updateDoctorProfile,
    activateEmergencyDelay,
    deactivateEmergencyDelay,
    getCustomReferences,
    addCustomReference,
};
