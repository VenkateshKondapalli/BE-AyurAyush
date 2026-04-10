const mongoose = require("mongoose");
const { customAlphabet } = require("nanoid");
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
const { QueueTokenModel } = require("../../../models/queueTokenSchema");
const {
    calculateAge,
    calculateWaitingTime,
    generateTokenNumber,
    parsePagination,
} = require("../../../utils/helpers");
const {
    notifyAppointmentApproved,
    notifyAppointmentRejected,
    notifyDoctorOnboarded,
    notifyPatientTurnCalled,
} = require("../../../utils/appointmentNotifications");

const generateTemporaryPassword = customAlphabet(
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789",
    12,
);

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

const getDashboardStats = async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

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

    const result = appointments.map((apt) => {
        const rawDoctorId = (apt.doctorId?._id || apt.doctorId)?.toString();
        const rawPatientId = (apt.patientId?._id || apt.patientId)?.toString();
        const doctorUserId = doctorProfileMap.get(rawDoctorId) || rawDoctorId;
        const patientUserId =
            patientProfileMap.get(rawPatientId) || rawPatientId;

        const doctor = doctorMap.get(doctorUserId);
        const patientUser = userMap.get(patientUserId);
        const doctorUser = userMap.get(doctorUserId);

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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const appointments = await AppointmentModel.find({
        date: { $gte: todayStart, $lte: todayEnd },
        status: "confirmed",
    })
        .populate("patientId", "name email")
        .populate("doctorId", "name")
        .sort({ tokenSequence: 1, timeSlot: 1, createdAt: 1 });

    const normalizedAppointments = await Promise.all(
        appointments.map(assignTokenIfMissing),
    );

    const queue = normalizedAppointments.map((apt) => ({
        appointmentId: apt._id,
        tokenNumber: apt.tokenNumber,
        queueStatus: apt.queueStatus || "waiting",
        queueCallCount: apt.queueCallCount || 0,
        lastCalledAt: apt.lastCalledAt,
        date: apt.date,
        timeSlot: apt.timeSlot,
        patient: {
            id: apt.patientId?._id,
            name: apt.patientId?.name || "Patient",
            email: apt.patientId?.email,
        },
        doctor: {
            id: apt.doctorId?._id,
            name: apt.doctorId?.name || "Unassigned",
        },
    }));

    return {
        count: queue.length,
        appointments: queue,
    };
};

const callTodayQueuePatient = async (appointmentId, adminUserId) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const appointment = await AppointmentModel.findOne({
        _id: appointmentId,
        date: { $gte: todayStart, $lte: todayEnd },
        status: "confirmed",
    })
        .populate("patientId", "name email")
        .populate("doctorId", "name");

    if (!appointment) {
        const err = new Error("Today's confirmed appointment not found");
        err.statusCode = 404;
        throw err;
    }

    await assignTokenIfMissing(appointment);

    const now = new Date();
    const firstCall = !appointment.firstCallEmailSentAt;

    appointment.queueStatus = "called";
    appointment.queueCallCount = (appointment.queueCallCount || 0) + 1;
    appointment.lastCalledAt = now;
    appointment.queueNotificationMessage = firstCall
        ? "Please proceed to consultation area."
        : "Reminder: Your consultation turn is active.";
    appointment.adminApprovedBy = appointment.adminApprovedBy || adminUserId;

    if (firstCall) {
        appointment.firstCallEmailSentAt = now;
        notifyPatientTurnCalled(appointment.patientId?.email, {
            patientName: appointment.patientId?.name,
            doctorName: appointment.doctorId?.name || "Doctor",
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
        patientName: appointment.patientId?.name || "Patient",
        tokenNumber: appointment.tokenNumber,
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

    await appointment.rejectByAdmin(adminUserId, reason);

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
    } = bookingData;

    const patientUser = await UserModel.findOne({ email: patientEmail });
    if (!patientUser) {
        const err = new Error("Patient not found with this email");
        err.statusCode = 404;
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

    const session = await mongoose.startSession();
    let appointment;

    try {
        await session.withTransaction(async () => {
            let patient = await PatientModel.findOne(
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

            const createdAppointments = await AppointmentModel.create(
                [
                    {
                        patientId: patient._id,
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
                        originalBooking: {
                            doctorId,
                            date: new Date(date),
                            timeSlot,
                        },
                    },
                ],
                { session },
            );
            appointment = createdAppointments[0];

            const queueDate = new Date(date).toISOString().slice(0, 10);
            const queueType = appointment.queueType || "normal";
            const tokenDoc = await QueueTokenModel.findOneAndUpdate(
                { queueDate, doctorId, queueType },
                { $inc: { lastSequence: 1 } },
                { upsert: true, new: true, session },
            );

            appointment.tokenSequence = tokenDoc.lastSequence;
            appointment.queueDate = queueDate;
            appointment.tokenNumber = generateTokenNumber(
                queueDate,
                doctorId,
                tokenDoc.lastSequence,
            );
            await appointment.save({ session });
        });
    } finally {
        await session.endSession();
    }

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
    getTodayQueue,
    callTodayQueuePatient,
};
