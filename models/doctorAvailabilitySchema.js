const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const { getISTDayBounds, getISTDateKey } = require("../utils/helpers");

const doctorAvailabiltySchema = new Schema(
    {
        doctorId: {
            type: Schema.Types.ObjectId,
            ref: "user",
            required: true,
            unique: true,
        },
        availableDays: [
            {
                type: String,
                enum: [
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                    "Sunday",
                ],
            },
        ],
        timeSlots: {
            Monday: [
                {
                    type: String,
                },
            ],
            Tuesday: [
                {
                    type: String,
                },
            ],
            Wednesday: [
                {
                    type: String,
                },
            ],
            Thursday: [
                {
                    type: String,
                },
            ],
            Friday: [
                {
                    type: String,
                },
            ],
            Saturday: [
                {
                    type: String,
                },
            ],
            Sunday: [
                {
                    type: String,
                },
            ],
        },
        unavailableDates: [
            {
                date: Date,
                reason: String,
            },
        ],
        dateSpecificSlots: [
            {
                date: {
                    type: Date,
                    required: true,
                },
                slots: [
                    {
                        type: String,
                    },
                ],
                updatedBy: {
                    type: Schema.Types.ObjectId,
                    ref: "user",
                },
                updatedAt: {
                    type: Date,
                    default: Date.now,
                },
            },
        ],
        setByAdmin: {
            type: Schema.Types.ObjectId,
            ref: "user",
        },
        lastUpdatedBy: {
            type: Schema.Types.ObjectId,
            ref: "user",
        },
    },
    {
        timestamps: true,
        versionKey: false,
    },
);

//method to get available slots for a specific date
doctorAvailabiltySchema.methods.getAvailableSlotsForDate = function (date) {
    const dateKey = getISTDateKey(date);

    // Derive day name in IST to avoid UTC-offset day mismatch on the server
    const { year, month, day } = (() => {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
            year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(new Date(date));
        return {
            year:  Number(parts.find((p) => p.type === "year")?.value),
            month: Number(parts.find((p) => p.type === "month")?.value) - 1,
            day:   Number(parts.find((p) => p.type === "day")?.value),
        };
    })();
    const dayName = new Date(Date.UTC(year, month, day))
        .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

    const isUnavailable = this.unavailableDates.some((unavail) => {
        const unavailDate = new Date(unavail.date);
        const checkDate = new Date(date);
        return (
            unavailDate.getFullYear() === checkDate.getFullYear() &&
            unavailDate.getMonth() === checkDate.getMonth() &&
            unavailDate.getDate() === checkDate.getDate()
        );
    });

    if (isUnavailable) {
        return [];
    }

    const dateOverride = (this.dateSpecificSlots || []).find(
        (entry) => getISTDateKey(entry.date) === dateKey,
    );

    if (dateOverride) {
        return dateOverride.slots || [];
    }

    return this.timeSlots[dayName] || [];
};

//static metod to get avaialable slots for booking
doctorAvailabiltySchema.statics.getBookableSlots = async function (
    doctorId,
    date,
    AppointmentModel,
) {
    const availability = await this.findOne({ doctorId });
    if (!availability) {
        return [];
    }

    const allSlots = availability.getAvailableSlotsForDate(date);
    if (allSlots.length === 0) {
        return [];
    }

    const { start: dayStart, end: dayEnd } = getISTDayBounds(date);
    const bookedAppointments = await AppointmentModel.find({
        doctorId,
        date: {
            $gte: dayStart,
            $lte: dayEnd,
        },
        status: { $nin: ["cancelled", "rejected"] },
    }).select("timeSlot");

    const bookedSlots = bookedAppointments.map((apt) => apt.timeSlot);

    const slotCounts = bookedSlots.reduce((acc, slot) => {
        acc[slot] = (acc[slot] || 0) + 1;
        return acc;
    }, {});

    const SLOT_CAPACITY = 2; // Hardcoded capacity requirement

    const availableSlots = allSlots.filter(
        (slot) => (slotCounts[slot] || 0) < SLOT_CAPACITY,
    );

    return availableSlots;
};

const DoctorAvailabiltyModel = model(
    "doctorAvailability",
    doctorAvailabiltySchema,
);

module.exports = { DoctorAvailabiltyModel };
