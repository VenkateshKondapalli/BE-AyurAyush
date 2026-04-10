const { sendEmail } = require("./emailHelper");
const logger = require("./logger");

const buildEmailHtml = (title, body) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; padding: 1rem; }
    .card { max-width: 32rem; margin: 0 auto; background: #fff; border-radius: 1rem; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .header { background: #059669; color: #fff; padding: 1.25rem; text-align: center; }
    .header h1 { font-size: 1.5rem; margin: 0; }
    .content { padding: 1.5rem; color: #374151; line-height: 1.6; }
    .content h2 { color: #059669; margin-top: 0; }
    .detail { background: #ecfdf5; border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; }
    .detail p { margin: 0.25rem 0; }
    .footer { background: #f9fafb; padding: 0.75rem; text-align: center; font-size: 0.8rem; color: #6b7280; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header"><h1>AyurAyush</h1></div>
    <div class="content">
      <h2>${title}</h2>
      ${body}
    </div>
    <div class="footer"><p>AyurAyush Healthcare, LPU</p></div>
  </div>
</body>
</html>`;

// Fire-and-forget wrapper — logs errors but never throws
const sendNotification = async (toEmail, subject, title, body) => {
    try {
        await sendEmail(toEmail, subject, buildEmailHtml(title, body));
    } catch (err) {
        logger.error("Notification email failed", {
            subject,
            error: err.message,
        });
    }
};

const notifyAppointmentBooked = (
    patientEmail,
    { doctorName, date, timeSlot, urgencyLevel },
) => {
    const body = `
    <p>Your appointment has been submitted and is awaiting admin approval.</p>
    <div class="detail">
      <p><strong>Doctor:</strong> ${doctorName}</p>
      <p><strong>Date:</strong> ${new Date(date).toLocaleDateString()}</p>
      <p><strong>Time:</strong> ${timeSlot}</p>
      <p><strong>Urgency:</strong> ${urgencyLevel}</p>
    </div>
    <p>You will receive another email once the admin reviews your appointment.</p>`;
    sendNotification(
        patientEmail,
        "Appointment Booked - AyurAyush",
        "Appointment Submitted",
        body,
    );
};

const notifyAppointmentApproved = (
    patientEmail,
    {
        doctorName,
        date,
        timeSlot,
        wasEdited = false,
        editedFields = [],
        adminNotes = "",
    },
) => {
    const formatEditedFields = () => {
        if (!Array.isArray(editedFields) || editedFields.length === 0)
            return "";

        const latestByField = new Map();
        for (const edit of editedFields) {
            if (edit?.field) latestByField.set(edit.field, edit);
        }

        const rows = Array.from(latestByField.values())
            .map((edit) => {
                const oldVal = edit.oldValue ?? "N/A";
                const newVal = edit.newValue ?? "N/A";
                return `<p><strong>${edit.field}:</strong> ${oldVal} → ${newVal}</p>`;
            })
            .join("");

        if (!rows) return "";
        return `<div class="detail"><p><strong>Updated By Admin:</strong></p>${rows}</div>`;
    };

    const adminNoteBlock = adminNotes
        ? `<div class="detail"><p><strong>Admin Message:</strong> ${adminNotes}</p></div>`
        : "";

    const body = `
    <p>Your appointment has been <strong>approved</strong> by the admin.</p>
    <div class="detail">
      <p><strong>Doctor:</strong> ${doctorName}</p>
      <p><strong>Date:</strong> ${new Date(date).toLocaleDateString()}</p>
      <p><strong>Time:</strong> ${timeSlot}</p>
    </div>
    ${wasEdited ? formatEditedFields() : ""}
    ${adminNoteBlock}
    <p>Please arrive on time for your consultation.</p>`;
    sendNotification(
        patientEmail,
        "Appointment Approved - AyurAyush",
        "Appointment Confirmed",
        body,
    );
};

const notifyAppointmentRejected = (
    patientEmail,
    { doctorName, date, reason },
) => {
    const body = `
    <p>Unfortunately, your appointment has been <strong>rejected</strong>.</p>
    <div class="detail">
      <p><strong>Doctor:</strong> ${doctorName}</p>
      <p><strong>Date:</strong> ${new Date(date).toLocaleDateString()}</p>
      <p><strong>Reason:</strong> ${reason || "No reason provided"}</p>
    </div>
    <p>You can book a new appointment with a different doctor or time slot.</p>`;
    sendNotification(
        patientEmail,
        "Appointment Rejected - AyurAyush",
        "Appointment Rejected",
        body,
    );
};

const notifyAppointmentCompleted = (
    patientEmail,
    { doctorName, date, hasPrescription },
) => {
    const body = `
    <p>Your appointment has been marked as <strong>completed</strong>.</p>
    <div class="detail">
      <p><strong>Doctor:</strong> ${doctorName}</p>
      <p><strong>Date:</strong> ${new Date(date).toLocaleDateString()}</p>
      ${hasPrescription ? "<p><strong>Prescription:</strong> Available in your dashboard</p>" : ""}
    </div>
    <p>Thank you for visiting AyurAyush. We wish you a speedy recovery!</p>`;
    sendNotification(
        patientEmail,
        "Appointment Completed - AyurAyush",
        "Appointment Completed",
        body,
    );
};

const notifyAppointmentCancelled = (
    patientEmail,
    { doctorName, date, timeSlot },
) => {
    const body = `
    <p>Your appointment has been <strong>cancelled</strong> as requested.</p>
    <div class="detail">
      <p><strong>Doctor:</strong> ${doctorName}</p>
      <p><strong>Date:</strong> ${new Date(date).toLocaleDateString()}</p>
      <p><strong>Time:</strong> ${timeSlot}</p>
    </div>
    <p>You can book a new appointment anytime from your dashboard.</p>`;
    sendNotification(
        patientEmail,
        "Appointment Cancelled - AyurAyush",
        "Appointment Cancelled",
        body,
    );
};

const notifyDoctorOnboarded = (
    doctorEmail,
    { doctorName, temporaryPassword, loginUrl },
) => {
    const body = `
    <p>Your doctor account has been created and verified by the hospital admin.</p>
    <div class="detail">
      <p><strong>Name:</strong> ${doctorName}</p>
      <p><strong>Email:</strong> ${doctorEmail}</p>
      <p><strong>Temporary Password:</strong> ${temporaryPassword}</p>
      <p><strong>Login URL:</strong> <a href="${loginUrl}" target="_blank" rel="noopener noreferrer">${loginUrl}</a></p>
    </div>
    <p>Please login and change your password immediately.</p>`;
    sendNotification(
        doctorEmail,
        "Doctor Account Onboarding - AyurAyush",
        "Doctor Account Ready",
        body,
    );
};

const notifyPatientTurnCalled = (
    patientEmail,
    { patientName, doctorName, date, timeSlot, tokenNumber },
) => {
    const body = `
    <p>Hi ${patientName || "Patient"}, it is your turn for consultation.</p>
    <div class="detail">
      <p><strong>Doctor:</strong> ${doctorName}</p>
      <p><strong>Date:</strong> ${new Date(date).toLocaleDateString()}</p>
      <p><strong>Time:</strong> ${timeSlot}</p>
      <p><strong>Token:</strong> ${tokenNumber || "N/A"}</p>
    </div>
    <p>Please proceed to the consultation area.</p>`;
    sendNotification(
        patientEmail,
        "Your Turn for Consultation - AyurAyush",
        "Consultation Turn Alert",
        body,
    );
};

module.exports = {
    notifyAppointmentBooked,
    notifyAppointmentApproved,
    notifyAppointmentRejected,
    notifyAppointmentCompleted,
    notifyAppointmentCancelled,
    notifyDoctorOnboarded,
    notifyPatientTurnCalled,
};
