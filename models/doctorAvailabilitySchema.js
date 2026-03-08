const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const doctorAvailabiltySchema = new Schema(
  {
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "user",
      required: true,
      unique: true,
      index: true,
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
      WeakSetednesday: [
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
  const dayName = new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
  });

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

  return this.timeSlots[dayName] || [];
};

//static metod to get avaialable slots for booking
doctorAvailabiltySchema.statics.getBookableSlots = async function (
  doctorId,
  date,
  appointmentModel,
) {
  const availability = await this.findOne({ doctorId });
  if (!availability) {
    return [];
  }

  const allSlots = availability.getAvailableSlotsForDate(date);
  if (allSlots.length === 0) {
    return [];
  }

  const bookedAppointments = await appointmentModel
    .find({
      doctorId,
      date: {
        $gte: new Date(date).setHours(0, 0, 0, 0),
        $lte: new Date(date).setHours(23, 59, 59, 999),
      },
      status: { $nin: ["cancelled", "rejected"] },
    })
    .select("timeSlot");

  const bookedSlots = bookedAppointments.map((apt) => apt.timeSlot);

  const availableSlots = allSlots.filter((slot) => !bookedSlots.includes(slot));

  return availableSlots;
};

const DoctorAvailabiltyModel = model(
  "doctorAvailability",
  doctorAvailabiltySchema,
);

module.exports = { DoctorAvailabiltyModel };
