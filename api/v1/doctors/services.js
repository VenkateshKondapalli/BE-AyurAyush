const { AppointmentModel } = require("../../../models/appointmentSchema");
const { ChatHistoryModel } = require("../../../models/chatHistorySchema");
const { DoctorModel } = require("../../../models/doctorSchema");
const { PatientModel } = require("../../../models/patientSchema");
const { UserModel } = require("../../../models/userSchema");
const { calculateAge, parsePagination } = require("../../../utils/helpers");
const logger = require("../../../utils/logger");
const {
    notifyAppointmentCompleted,
} = require("../../../utils/appointmentNotifications");

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
    const todayAppointments = todayAppointmentsDocs.map((apt) => ({
        appointmentId: apt._id,
        patient: {
            id: apt.patientId?._id,
            name: apt.patientId?.name || "Patient",
        },
        timeSlot: apt.timeSlot,
        status: apt.status,
        urgencyLevel: apt.urgencyLevel,
        date: apt.date,
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

        return {
            appointmentId: apt._id,
            status: apt.status,
            urgencyLevel: apt.urgencyLevel,
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

    // Batch fetch all patient profiles in one query
    const patientUserIds = appointments.map((apt) => apt.patientId._id);
    const patientProfiles = await PatientModel.find({
        userId: { $in: patientUserIds },
    }).select("userId bloodGroup allergies emergencyContact");
    const profileMap = new Map(
        patientProfiles.map((p) => [p.userId.toString(), p]),
    );

    const appointmentsWithDetails = appointments.map((apt) => {
        const patientProfile = profileMap.get(apt.patientId._id.toString());

        return {
            appointmentId: apt._id,
            status: apt.status,
            date: apt.date,
            urgencyLevel: apt.urgencyLevel,
            timeSlot: apt.timeSlot,
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
        appointments: appointmentsWithDetails,
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
    getDoctorProfile,
    updateDoctorProfile,
};
