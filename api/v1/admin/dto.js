const rejectAppointmentValidator = (req, res, next) => {
    try {
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({
                isSuccess: false,
                message: "Rejection reason is required",
            });
        }

        next();
    } catch (err) {
        res.status(500).json({
            isSuccess: false,
            message: "Internal Server Error",
        });
    }
};

const VALID_DAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];

const setDoctorAvailabilityValidator = (req, res, next) => {
    try {
        const { availableDays, timeSlots, unavailableDates } = req.body;

        if (!availableDays || !timeSlots) {
            return res.status(400).json({
                isSuccess: false,
                message: "availableDays and timeSlots are required",
            });
        }

        if (!Array.isArray(availableDays) || availableDays.length === 0) {
            return res.status(400).json({
                isSuccess: false,
                message: "availableDays must be a non-empty array",
            });
        }

        const invalidDays = availableDays.filter(
            (day) => !VALID_DAYS.includes(day),
        );
        if (invalidDays.length > 0) {
            return res.status(400).json({
                isSuccess: false,
                message: `Invalid days: ${invalidDays.join(", ")}. Must be full day names e.g. Monday`,
            });
        }

        if (typeof timeSlots !== "object" || Array.isArray(timeSlots)) {
            return res.status(400).json({
                isSuccess: false,
                message: "timeSlots must be an object keyed by day name",
            });
        }

        for (const day of availableDays) {
            if (
                !timeSlots[day] ||
                !Array.isArray(timeSlots[day]) ||
                timeSlots[day].length === 0
            ) {
                return res.status(400).json({
                    isSuccess: false,
                    message: `timeSlots must have at least one slot for ${day}`,
                });
            }

            const invalidSlots = timeSlots[day].filter(
                (slot) => !/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(slot),
            );
            if (invalidSlots.length > 0) {
                return res.status(400).json({
                    isSuccess: false,
                    message: `Invalid time format in ${day}: ${invalidSlots.join(", ")}. Use HH:MM - HH:MM (e.g. 09:00 - 10:00)`,
                });
            }
        }

        if (unavailableDates !== undefined) {
            if (!Array.isArray(unavailableDates)) {
                return res.status(400).json({
                    isSuccess: false,
                    message: "unavailableDates must be an array",
                });
            }

            for (const entry of unavailableDates) {
                if (!entry?.date) {
                    return res.status(400).json({
                        isSuccess: false,
                        message:
                            "Each unavailableDate entry must have a date field",
                    });
                }

                if (isNaN(new Date(entry.date).getTime())) {
                    return res.status(400).json({
                        isSuccess: false,
                        message: `Invalid date in unavailableDates: ${entry.date}`,
                    });
                }
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

const offlineBookValidator = (req, res, next) => {
    try {
        const {
            patientEmail,
            doctorId,
            date,
            timeSlot,
            isEmergencyTriage,
            emergencyPatientName,
        } = req.body;

        if (!doctorId) {
            return res.status(400).json({
                isSuccess: false,
                message: "doctorId is required",
            });
        }

        if (isEmergencyTriage) {
            if (!emergencyPatientName) {
                return res.status(400).json({
                    isSuccess: false,
                    message:
                        "emergencyPatientName is required for emergency triage booking",
                });
            }
            return next();
        }

        if (!patientEmail || !date || !timeSlot) {
            return res.status(400).json({
                isSuccess: false,
                message:
                    "patientEmail, doctorId, date, and timeSlot are required for standard offline booking",
            });
        }

        next();
    } catch (err) {
        res.status(500).json({
            isSuccess: false,
            message: "Internal Server Error",
        });
    }
};

const createDoctorAccountValidator = (req, res, next) => {
    try {
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
        } = req.body;

        if (
            !name ||
            !email ||
            !phone ||
            !gender ||
            !dob ||
            !qualification ||
            !specialization ||
            experience === undefined ||
            !licenseNumber
        ) {
            return res.status(400).json({
                isSuccess: false,
                message:
                    "name, email, phone, gender, dob, qualification, specialization, experience, and licenseNumber are required",
            });
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
    rejectAppointmentValidator,
    offlineBookValidator,
    createDoctorAccountValidator,
    setDoctorAvailabilityValidator,
};
