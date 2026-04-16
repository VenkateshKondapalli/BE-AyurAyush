const { getISTDayBounds } = require("../../../utils/helpers");

const VALID_QUEUE_TYPES = ["normal", "ayurveda", "panchakarma"];

const bookAppointmentValidator = (req, res, next) => {
    const {
        conversationId,
        doctorId,
        date,
        timeSlot,
        queueType = "normal",
        treatmentCode,
        therapistId,
        roomId,
    } = req.body;

    if (!conversationId || !doctorId || !date || !timeSlot) {
        return res.status(400).json({
            isSuccess: false,
            message:
                "All fields are required: conversationId, doctorId, date, timeSlot",
        });
    }

    if (!VALID_QUEUE_TYPES.includes(queueType)) {
        return res.status(400).json({
            isSuccess: false,
            message: `queueType must be one of: ${VALID_QUEUE_TYPES.join(", ")}`,
        });
    }

    // Ayurveda and Panchakarma bookings must specify a treatmentCode
    if (queueType !== "normal" && !treatmentCode) {
        return res.status(400).json({
            isSuccess: false,
            message: `treatmentCode is required for queueType "${queueType}"`,
        });
    }

    // Panchakarma bookings must specify therapist and room
    if (queueType === "panchakarma" && (!therapistId || !roomId)) {
        return res.status(400).json({
            isSuccess: false,
            message:
                "therapistId and roomId are required for panchakarma appointments",
        });
    }

    // Validate date is not in the past
    const appointmentDate = new Date(date);
    if (isNaN(appointmentDate.getTime())) {
        return res
            .status(400)
            .json({ isSuccess: false, message: "Invalid date" });
    }
    const { start: todayStartIST } = getISTDayBounds();
    if (appointmentDate < todayStartIST) {
        return res.status(400).json({
            isSuccess: false,
            message: "Appointment date cannot be in the past",
        });
    }

    next();
};

const getAvailableSlotsValidator = (req, res, next) => {
    const { doctorId, date } = req.query;

    if (!doctorId || !date) {
        return res.status(400).json({
            isSuccess: false,
            message: "DoctorID and date are required",
        });
    }

    next();
};

const applyDoctorRoleValidator = (req, res, next) => {
    const { qualification, specialization, experience, licenseNumber } =
        req.body;

    if (!qualification || !specialization || !experience || !licenseNumber) {
        return res.status(400).json({
            isSuccess: false,
            message:
                "All fields are required: qualification, specialization, experience, licenseNumber",
        });
    }

    next();
};

const VALID_BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const updatePatientProfileValidator = (req, res, next) => {
    try {
        const {
            bloodGroup,
            medicalHistory,
            allergies,
            emergencyContact,
            name,
            phone,
            gender,
            dob,
        } = req.body;

        if (
            bloodGroup === undefined &&
            medicalHistory === undefined &&
            allergies === undefined &&
            emergencyContact === undefined &&
            name === undefined &&
            phone === undefined &&
            gender === undefined &&
            dob === undefined
        ) {
            return res.status(400).json({
                isSuccess: false,
                message: "At least one field must be provided to update",
            });
        }

        if (
            bloodGroup !== undefined &&
            !VALID_BLOOD_GROUPS.includes(bloodGroup)
        ) {
            return res.status(400).json({
                isSuccess: false,
                message: `bloodGroup must be one of: ${VALID_BLOOD_GROUPS.join(", ")}`,
            });
        }

        if (medicalHistory !== undefined && !Array.isArray(medicalHistory)) {
            return res.status(400).json({
                isSuccess: false,
                message: "medicalHistory must be an array",
            });
        }

        if (allergies !== undefined && !Array.isArray(allergies)) {
            return res.status(400).json({
                isSuccess: false,
                message: "allergies must be an array",
            });
        }

        if (phone !== undefined && !/^\d{10}$/.test(phone)) {
            return res.status(400).json({
                isSuccess: false,
                message: "Phone must be a 10-digit number",
            });
        }

        if (
            gender !== undefined &&
            !["male", "female", "other"].includes(gender)
        ) {
            return res.status(400).json({
                isSuccess: false,
                message: "gender must be one of: male, female, other",
            });
        }

        if (dob !== undefined) {
            const dobDate = new Date(dob);
            if (isNaN(dobDate.getTime())) {
                return res.status(400).json({
                    isSuccess: false,
                    message: "Invalid date of birth",
                });
            }
            if (dobDate >= new Date()) {
                return res.status(400).json({
                    isSuccess: false,
                    message: "Date of birth cannot be in the future",
                });
            }
        }

        if (emergencyContact !== undefined) {
            if (
                emergencyContact === null ||
                typeof emergencyContact !== "object" ||
                Array.isArray(emergencyContact)
            ) {
                return res.status(400).json({
                    isSuccess: false,
                    message: "emergencyContact must be an object",
                });
            }

            const { name: ecName, phone: ecPhone, relation } = emergencyContact;
            const hasAnyValue = !!(ecName || ecPhone || relation);

            if (hasAnyValue && (!ecName || !ecPhone || !relation)) {
                return res.status(400).json({
                    isSuccess: false,
                    message:
                        "emergencyContact must have name, phone, and relation",
                });
            }

            if (ecPhone && !/^\d{10}$/.test(ecPhone)) {
                return res.status(400).json({
                    isSuccess: false,
                    message: "emergencyContact.phone must be a 10-digit number",
                });
            }
        }

        next();
    } catch (err) {
        res.status(500).json({
            isSuccess: false,
            message: "Internal Server Error",
        });
    }
};

module.exports = {
    bookAppointmentValidator,
    getAvailableSlotsValidator,
    applyDoctorRoleValidator,
    updatePatientProfileValidator,
};
