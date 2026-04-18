const { customAlphabet } = require("nanoid");
const { UserModel, ROLE_OPTIONS } = require("../../../models/userSchema");
const { SubAdminProfileModel } = require("../../../models/subAdminProfileSchema");
const { AppointmentModel } = require("../../../models/appointmentSchema");
const { PaymentModel } = require("../../../models/paymentSchema");
const { DoctorModel } = require("../../../models/doctorSchema");
const { getISTDayBounds } = require("../../../utils/helpers");
const { notifySubAdminOnboarded } = require("../../../utils/appointmentNotifications");
const logger = require("../../../utils/logger");

const generateTemporaryPassword = customAlphabet(
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789",
    12,
);

// ─── Create Sub-Admin ────────────────────────────────────────────────────────

const createSubAdmin = async (superAdminUserId, payload) => {
    const { name, email, phone, gender, dob, queueScope, permissions, notes } = payload;

    const existing = await UserModel.findOne({ $or: [{ email }, { phone }] });
    if (existing) {
        const err = new Error(
            existing.email === email ? "Email already exists" : "Phone already exists",
        );
        err.statusCode = 409;
        throw err;
    }

    const tempPassword = generateTemporaryPassword();

    const newUser = await UserModel.create({
        name,
        email,
        phone,
        gender,
        dob,
        password: tempPassword,
        roles: [ROLE_OPTIONS.SUB_ADMIN],
        mustChangePassword: true,
    });

    const profile = await SubAdminProfileModel.create({
        userId: newUser._id,
        createdBy: superAdminUserId,
        queueScope: queueScope || "all",
        permissions: permissions || {},
        notes: notes || "",
    });

    logger.info("Sub-admin created", { userId: newUser._id, createdBy: superAdminUserId });

    const loginUrl = `${process.env.FRONTEND_URL_LOCAL || "http://localhost:5173"}/login`;
    notifySubAdminOnboarded(email, {
        subAdminName: name,
        temporaryPassword: tempPassword,
        loginUrl,
    });

    return {
        userId: newUser._id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        queueScope: profile.queueScope,
        permissions: profile.permissions,
        temporaryPassword: tempPassword,
        mustChangePassword: true,
    };
};

// ─── List Sub-Admins ─────────────────────────────────────────────────────────

const listSubAdmins = async () => {
    const profiles = await SubAdminProfileModel.find()
        .populate("userId", "name email phone isActive")
        .populate("createdBy", "name")
        .sort({ createdAt: -1 });

    return profiles.map((p) => ({
        profileId: p._id,
        userId: p.userId?._id,
        name: p.userId?.name || "Unknown",
        email: p.userId?.email,
        phone: p.userId?.phone,
        isActive: p.isActive && p.userId?.isActive !== false,
        queueScope: p.queueScope,
        permissions: p.permissions,
        notes: p.notes,
        createdBy: p.createdBy?.name || "Super Admin",
        createdAt: p.createdAt,
    }));
};

// ─── Update Sub-Admin Permissions ────────────────────────────────────────────

const updateSubAdmin = async (profileId, payload) => {
    const { queueScope, permissions, notes, isActive } = payload;

    const profile = await SubAdminProfileModel.findById(profileId);
    if (!profile) {
        const err = new Error("Sub-admin profile not found");
        err.statusCode = 404;
        throw err;
    }

    if (queueScope !== undefined) profile.queueScope = queueScope;
    if (permissions !== undefined) profile.permissions = { ...profile.permissions.toObject(), ...permissions };
    if (notes !== undefined) profile.notes = notes;
    if (isActive !== undefined) {
        profile.isActive = isActive;
        // Also deactivate/activate the user account
        await UserModel.findByIdAndUpdate(profile.userId, { isActive });
    }

    await profile.save();

    const user = await UserModel.findById(profile.userId).select("name email phone");

    return {
        profileId: profile._id,
        userId: profile.userId,
        name: user?.name,
        email: user?.email,
        queueScope: profile.queueScope,
        permissions: profile.permissions,
        notes: profile.notes,
        isActive: profile.isActive,
    };
};

// ─── Delete (Deactivate) Sub-Admin ───────────────────────────────────────────

const deactivateSubAdmin = async (profileId) => {
    const profile = await SubAdminProfileModel.findById(profileId);
    if (!profile) {
        const err = new Error("Sub-admin profile not found");
        err.statusCode = 404;
        throw err;
    }
    profile.isActive = false;
    await profile.save();
    await UserModel.findByIdAndUpdate(profile.userId, { isActive: false });
    return { profileId, deactivated: true };
};

// ─── Super Admin System Dashboard ────────────────────────────────────────────

const getSuperAdminDashboard = async () => {
    const { start: todayStart, end: todayEnd } = getISTDayBounds();
    const { year, month } = (() => {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
            year: "numeric", month: "2-digit",
        }).formatToParts(new Date());
        return {
            year: Number(parts.find((p) => p.type === "year")?.value),
            month: Number(parts.find((p) => p.type === "month")?.value) - 1,
        };
    })();
    // IST month start = UTC equivalent of IST 1st of month 00:00
    const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0) - 330 * 60 * 1000);

    const [
        totalUsers,
        totalDoctors,
        totalPatients,
        totalSubAdmins,
        activeSubAdmins,
        todayAppointments,
        pendingApprovals,
        pendingPayments,
        todayRevenue,
        monthRevenue,
        subAdminProfiles,
        appointmentsByQueueType,
    ] = await Promise.all([
        UserModel.countDocuments({ isActive: true }),
        UserModel.countDocuments({ roles: "doctor", isActive: true }),
        UserModel.countDocuments({ roles: "patient", isActive: true }),
        SubAdminProfileModel.countDocuments(),
        SubAdminProfileModel.countDocuments({ isActive: true }),
        AppointmentModel.countDocuments({
            date: { $gte: todayStart, $lte: todayEnd },
            status: { $nin: ["cancelled", "rejected", "pending_payment"] },
        }),
        AppointmentModel.countDocuments({ status: "pending_admin_approval" }),
        AppointmentModel.countDocuments({ status: "pending_payment" }),
        PaymentModel.aggregate([
            { $match: { status: "paid", paidAt: { $gte: todayStart, $lte: todayEnd } } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        PaymentModel.aggregate([
            { $match: { status: "paid", paidAt: { $gte: monthStart } } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        SubAdminProfileModel.find({ isActive: true })
            .populate("userId", "name email")
            .select("userId queueScope permissions isActive"),
        AppointmentModel.aggregate([
            { $match: { status: { $nin: ["cancelled", "rejected"] } } },
            { $group: { _id: "$queueType", count: { $sum: 1 } } },
        ]),
    ]);

    const queueTypeMap = {};
    appointmentsByQueueType.forEach((q) => {
        queueTypeMap[q._id || "normal"] = q.count;
    });

    return {
        stats: {
            totalUsers,
            totalDoctors,
            totalPatients,
            totalSubAdmins,
            activeSubAdmins,
            todayAppointments,
            pendingApprovals,
            pendingPayments,
            todayRevenue: Number(((todayRevenue[0]?.total || 0) / 100).toFixed(2)),
            monthRevenue: Number(((monthRevenue[0]?.total || 0) / 100).toFixed(2)),
        },
        appointmentsByQueueType: {
            ayurveda: queueTypeMap.ayurveda || 0,
            panchakarma: queueTypeMap.panchakarma || 0,
            normal: queueTypeMap.normal || 0,
        },
        subAdmins: subAdminProfiles.map((p) => ({
            userId: p.userId?._id,
            name: p.userId?.name || "Unknown",
            email: p.userId?.email,
            queueScope: p.queueScope,
            permissions: p.permissions,
        })),
    };
};

// ─── Get Sub-Admin Profile (for /auth/me enrichment) ─────────────────────────

const getSubAdminProfile = async (userId) => {
    return SubAdminProfileModel.findOne({ userId, isActive: true }).select(
        "queueScope permissions isActive",
    );
};

module.exports = {
    createSubAdmin,
    listSubAdmins,
    updateSubAdmin,
    deactivateSubAdmin,
    getSuperAdminDashboard,
    getSubAdminProfile,
};
