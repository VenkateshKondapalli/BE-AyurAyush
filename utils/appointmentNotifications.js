const { sendEmail } = require("./emailHelper");
const logger = require("./logger");

const FRONTEND_URL = process.env.FRONTEND_URL_CUSTOM_DOMAIN ||
    process.env.FRONTEND_URL_VERCEL ||
    process.env.FRONTEND_URL_LOCAL ||
    "http://localhost:5173";

// ─── Shared builder ──────────────────────────────────────────────────────────

const buildEmail = ({
    headerClass,
    title,
    greeting,
    message,
    detailHeaderClass,
    detailTitle = "Appointment Details",
    rows = [],
    noteClass,
    noteText,
    btnClass,
    btnText,
    btnHref,
    extraHtml = "",
}) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${noteClass?.includes("green") ? "#f0fdf4" : noteClass?.includes("blue") ? "#eff6ff" : noteClass?.includes("red") ? "#fef2f2" : noteClass?.includes("purple") ? "#faf5ff" : noteClass?.includes("amber") ? "#fffbeb" : noteClass?.includes("teal") ? "#f0fdfa" : "#f9fafb"};padding:1.5rem;}
    .card{max-width:480px;margin:0 auto;background:#fff;border-radius:1rem;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.12);}
    .hdr{padding:2rem;text-align:center;background:${headerClass};}
    .brand{font-size:1.4rem;font-weight:800;letter-spacing:0.15em;color:#fff;text-transform:uppercase;}
    .hdivider{width:3rem;height:2px;background:rgba(255,255,255,0.4);margin:0.75rem auto;border-radius:2px;}
    .htitle{font-size:0.95rem;font-weight:600;color:rgba(255,255,255,0.92);letter-spacing:0.02em;}
    .body{padding:1.75rem 2rem;color:#374151;font-size:0.9rem;line-height:1.7;}
    .greeting{font-size:0.95rem;font-weight:600;color:#111827;margin-bottom:0.5rem;}
    .message{color:#4b5563;margin-bottom:1.25rem;}
    .detail-card{border-radius:0.625rem;background:#f9fafb;border:1px solid #e5e7eb;overflow:hidden;margin-bottom:1.25rem;}
    .detail-hdr{padding:0.625rem 1rem;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#fff;background:${detailHeaderClass};}
    table{width:100%;border-collapse:collapse;}
    tr{border-bottom:1px solid #f3f4f6;}
    tr:last-child{border-bottom:none;}
    td{padding:0.6rem 1rem;font-size:0.85rem;}
    td:first-child{color:#6b7280;font-weight:500;width:38%;border-right:1px solid #f3f4f6;}
    td:last-child{color:#111827;font-weight:600;}
    .note{border-radius:0.5rem;padding:0.875rem 1rem;font-size:0.85rem;margin-bottom:1.25rem;border-left:4px solid;background:${noteClass?.includes("green") ? "#f0fdf4" : noteClass?.includes("blue") ? "#eff6ff" : noteClass?.includes("red") ? "#fef2f2" : noteClass?.includes("purple") ? "#faf5ff" : noteClass?.includes("amber") ? "#fffbeb" : noteClass?.includes("teal") ? "#f0fdfa" : "#f9fafb"};border-color:${noteClass?.includes("green") ? "#059669" : noteClass?.includes("blue") ? "#2563eb" : noteClass?.includes("red") ? "#dc2626" : noteClass?.includes("purple") ? "#7c3aed" : noteClass?.includes("amber") ? "#d97706" : noteClass?.includes("teal") ? "#0d9488" : "#6b7280"};color:${noteClass?.includes("green") ? "#065f46" : noteClass?.includes("blue") ? "#1e40af" : noteClass?.includes("red") ? "#991b1b" : noteClass?.includes("purple") ? "#4c1d95" : noteClass?.includes("amber") ? "#92400e" : noteClass?.includes("teal") ? "#115e59" : "#374151"};}
    .btn{display:block;width:100%;padding:0.875rem;border-radius:0.625rem;text-align:center;font-size:0.875rem;font-weight:700;color:#fff;text-decoration:none;letter-spacing:0.03em;margin-bottom:1.25rem;background:${btnClass};}
    .footer{padding:1rem 2rem;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;}
    .fbrand{font-size:0.8rem;font-weight:700;color:#374151;letter-spacing:0.05em;text-transform:uppercase;}
    .fsub{font-size:0.72rem;color:#9ca3af;margin-top:0.2rem;}
  </style>
</head>
<body>
  <div class="card">
    <div class="hdr">
      <div class="brand">AyurAyush</div>
      <div class="hdivider"></div>
      <div class="htitle">${title}</div>
    </div>
    <div class="body">
      <p class="greeting">${greeting}</p>
      <p class="message">${message}</p>
      ${rows.length > 0 ? `
      <div class="detail-card">
        <div class="detail-hdr">${detailTitle}</div>
        <table>${rows.map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join("")}</table>
      </div>` : ""}
      ${noteText ? `<div class="note">${noteText}</div>` : ""}
      ${extraHtml}
      ${btnText && btnHref ? `<a class="btn" href="${btnHref}">${btnText}</a>` : ""}
    </div>
    <div class="footer">
      <div class="fbrand">AyurAyush Healthcare</div>
      <div class="fsub">Lovely Professional University &nbsp;&bull;&nbsp; &copy; ${new Date().getFullYear()}</div>
    </div>
  </div>
</body>
</html>`;

// ─── Header / button gradients ───────────────────────────────────────────────

const G = {
    green:  { hdr: "linear-gradient(135deg,#064e3b 0%,#065f46 60%,#047857 100%)", dh: "#065f46", btn: "linear-gradient(135deg,#065f46,#059669)" },
    blue:   { hdr: "linear-gradient(135deg,#1e3a5f 0%,#1e40af 60%,#2563eb 100%)", dh: "#1e40af", btn: "linear-gradient(135deg,#1e40af,#2563eb)" },
    red:    { hdr: "linear-gradient(135deg,#7f1d1d 0%,#991b1b 60%,#b91c1c 100%)", dh: "#991b1b", btn: "linear-gradient(135deg,#991b1b,#dc2626)" },
    purple: { hdr: "linear-gradient(135deg,#3b0764 0%,#4c1d95 60%,#6d28d9 100%)", dh: "#4c1d95", btn: "linear-gradient(135deg,#4c1d95,#7c3aed)" },
    grey:   { hdr: "linear-gradient(135deg,#1f2937 0%,#374151 60%,#4b5563 100%)", dh: "#374151", btn: "linear-gradient(135deg,#374151,#6b7280)" },
    amber:  { hdr: "linear-gradient(135deg,#78350f 0%,#92400e 60%,#b45309 100%)", dh: "#92400e", btn: "linear-gradient(135deg,#92400e,#d97706)" },
    teal:   { hdr: "linear-gradient(135deg,#134e4a 0%,#115e59 60%,#0f766e 100%)", dh: "#115e59", btn: "linear-gradient(135deg,#115e59,#0d9488)" },
    orange: { hdr: "linear-gradient(135deg,#7c2d12 0%,#9a3412 60%,#c2410c 100%)", dh: "#9a3412", btn: "linear-gradient(135deg,#9a3412,#ea580c)" },
};

const formatDate = (d) => new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "long", year: "numeric",
});

// ─── Fire-and-forget wrapper ─────────────────────────────────────────────────

const sendNotification = async (toEmail, subject, html) => {
    try {
        await sendEmail(toEmail, subject, html);
    } catch (err) {
        logger.error("Notification email failed", { subject, error: err.message });
    }
};

// ─── Email functions ─────────────────────────────────────────────────────────

const notifyAppointmentBooked = (patientEmail, { patientName, doctorName, date, timeSlot, urgencyLevel }) => {
    sendNotification(patientEmail, "Appointment Submitted — AyurAyush",
        buildEmail({
            headerClass: G.blue.hdr,
            title: "Appointment Submitted",
            greeting: `Dear ${patientName || "Patient"},`,
            message: "Your appointment request has been successfully submitted and is currently awaiting admin review. You will be notified once it is approved.",
            detailHeaderClass: G.blue.dh,
            rows: [
                ["Doctor", `Dr. ${doctorName}`],
                ["Date", formatDate(date)],
                ["Time Slot", timeSlot],
                ["Urgency", urgencyLevel === "emergency" ? "Emergency" : "Normal"],
            ],
            noteClass: "blue",
            noteText: "Estimated review time: within 24 hours. Please keep an eye on your inbox.",
            btnClass: G.blue.btn,
            btnText: "View Appointment Status",
            btnHref: `${FRONTEND_URL}/patient/appointments`,
        }),
    );
};

const notifyAppointmentApproved = (patientEmail, { patientName, doctorName, date, timeSlot, wasEdited = false, editedFields = [], adminNotes = "" }) => {
    let extraHtml = "";

    if (wasEdited && Array.isArray(editedFields) && editedFields.length > 0) {
        const latestByField = new Map();
        for (const edit of editedFields) {
            if (edit?.field) latestByField.set(edit.field, edit);
        }
        const rows = Array.from(latestByField.values())
            .map((e) => `<tr><td>${e.field}</td><td>${e.oldValue ?? "N/A"} &rarr; ${e.newValue ?? "N/A"}</td></tr>`)
            .join("");
        if (rows) {
            extraHtml += `<div class="detail-card"><div class="detail-hdr" style="background:${G.green.dh}">Changes Made by Admin</div><table>${rows}</table></div>`;
        }
    }

    if (adminNotes) {
        extraHtml += `<div class="note" style="background:#f0fdf4;border-color:#059669;border-left:4px solid #059669;color:#065f46;border-radius:0.5rem;padding:0.875rem 1rem;font-size:0.85rem;margin-bottom:1.25rem;"><strong>Admin Note:</strong> ${adminNotes}</div>`;
    }

    sendNotification(patientEmail, "Appointment Confirmed — AyurAyush",
        buildEmail({
            headerClass: G.green.hdr,
            title: "Appointment Confirmed",
            greeting: `Dear ${patientName || "Patient"},`,
            message: "Your appointment has been reviewed and confirmed by our admin team. Please make sure to arrive on time for your consultation.",
            detailHeaderClass: G.green.dh,
            rows: [
                ["Doctor", `Dr. ${doctorName}`],
                ["Date", formatDate(date)],
                ["Time Slot", timeSlot],
                ["Status", "Confirmed"],
            ],
            noteClass: "green",
            noteText: "Please arrive 10 minutes before your scheduled time and carry any relevant medical records.",
            btnClass: G.green.btn,
            btnText: "View Appointment Details",
            btnHref: `${FRONTEND_URL}/patient/appointments`,
            extraHtml,
        }),
    );
};

const notifyAppointmentRejected = (patientEmail, { patientName, doctorName, date, reason }) => {
    sendNotification(patientEmail, "Appointment Not Approved — AyurAyush",
        buildEmail({
            headerClass: G.red.hdr,
            title: "Appointment Not Approved",
            greeting: `Dear ${patientName || "Patient"},`,
            message: "We regret to inform you that your appointment request could not be approved at this time. Please review the details below.",
            detailHeaderClass: G.red.dh,
            rows: [
                ["Doctor", `Dr. ${doctorName}`],
                ["Date", formatDate(date)],
                ["Reason", reason || "No reason provided"],
            ],
            noteClass: "red",
            noteText: "You may book a new appointment with a different doctor or time slot from your dashboard.",
            btnClass: G.red.btn,
            btnText: "Book a New Appointment",
            btnHref: `${FRONTEND_URL}/patient/book-appointment`,
        }),
    );
};

const notifyAppointmentCompleted = (patientEmail, { patientName, doctorName, date, hasPrescription }) => {
    sendNotification(patientEmail, "Consultation Completed — AyurAyush",
        buildEmail({
            headerClass: G.purple.hdr,
            title: "Consultation Completed",
            greeting: `Dear ${patientName || "Patient"},`,
            message: "Your consultation has been successfully completed. We hope you had a positive experience with our healthcare team.",
            detailHeaderClass: G.purple.dh,
            detailTitle: "Consultation Summary",
            rows: [
                ["Doctor", `Dr. ${doctorName}`],
                ["Date", formatDate(date)],
                ["Prescription", hasPrescription ? "Available in dashboard" : "Not prescribed"],
            ],
            noteClass: "purple",
            noteText: hasPrescription
                ? "Your prescription and doctor notes are available in your patient dashboard. Please follow the prescribed treatment plan."
                : "Your doctor notes are available in your patient dashboard.",
            btnClass: G.purple.btn,
            btnText: hasPrescription ? "View Prescription" : "View Appointment",
            btnHref: `${FRONTEND_URL}/patient/appointments`,
        }),
    );
};

const notifyAppointmentCancelled = (patientEmail, { patientName, doctorName, date, timeSlot }) => {
    sendNotification(patientEmail, "Appointment Cancelled — AyurAyush",
        buildEmail({
            headerClass: G.grey.hdr,
            title: "Appointment Cancelled",
            greeting: `Dear ${patientName || "Patient"},`,
            message: "Your appointment has been cancelled as requested. We hope to see you again soon.",
            detailHeaderClass: G.grey.dh,
            detailTitle: "Cancelled Appointment",
            rows: [
                ["Doctor", `Dr. ${doctorName}`],
                ["Date", formatDate(date)],
                ["Time Slot", timeSlot],
            ],
            noteClass: "grey",
            noteText: "You can book a new appointment anytime from your patient dashboard.",
            btnClass: G.grey.btn,
            btnText: "Book New Appointment",
            btnHref: `${FRONTEND_URL}/patient/book-appointment`,
        }),
    );
};

const notifyPatientTurnCalled = (patientEmail, { patientName, doctorName, date, timeSlot, tokenNumber }) => {
    sendNotification(patientEmail, "Your Consultation Turn — AyurAyush",
        buildEmail({
            headerClass: G.amber.hdr,
            title: "Your Consultation Turn",
            greeting: `Dear ${patientName || "Patient"},`,
            message: "It is now your turn for consultation. Please proceed to the consultation area immediately.",
            detailHeaderClass: G.amber.dh,
            detailTitle: "Queue Information",
            rows: [
                ["Doctor", `Dr. ${doctorName}`],
                ["Date", formatDate(date)],
                ["Time Slot", timeSlot],
                ["Token", tokenNumber || "N/A"],
            ],
            noteClass: "amber",
            noteText: "Please report to the reception desk with your token number. Failure to appear may result in your slot being reassigned.",
            btnClass: G.amber.btn,
            btnText: "View Queue Status",
            btnHref: `${FRONTEND_URL}/patient/appointments`,
        }),
    );
};

const notifyDoctorOnboarded = (doctorEmail, { doctorName, temporaryPassword, loginUrl }) => {
    sendNotification(doctorEmail, "Doctor Account Ready — AyurAyush",
        buildEmail({
            headerClass: G.teal.hdr,
            title: "Doctor Account Ready",
            greeting: `Dear Dr. ${doctorName},`,
            message: "Your doctor account has been created and verified by the hospital administration. You can now log in to the AyurAyush portal to manage your appointments.",
            detailHeaderClass: G.teal.dh,
            detailTitle: "Login Credentials",
            rows: [
                ["Name", `Dr. ${doctorName}`],
                ["Email", doctorEmail],
                ["Temp Password", temporaryPassword],
            ],
            noteClass: "teal",
            noteText: "For security, please log in and change your password immediately. Your temporary password will expire after first use.",
            btnClass: G.teal.btn,
            btnText: "Login to Portal",
            btnHref: loginUrl,
        }),
    );
};

const notifyPatientNotAttended = (patientEmail, { patientName, doctorName, date, timeSlot, refundInitiated }) => {
    sendNotification(patientEmail, "Appointment Cancelled — No-Show — AyurAyush",
        buildEmail({
            headerClass: G.grey.hdr,
            title: "Appointment Cancelled",
            greeting: `Dear ${patientName || "Patient"},`,
            message: "We noticed you were unable to attend your scheduled appointment. As a result, your appointment has been marked as cancelled. We understand that circumstances can be unpredictable and we hope you are doing well.",
            detailHeaderClass: G.grey.dh,
            detailTitle: "Appointment Details",
            rows: [
                ["Doctor", `Dr. ${doctorName}`],
                ["Date", formatDate(date)],
                ["Time Slot", timeSlot],
                ["Refund", refundInitiated ? "Initiated — will reflect in 5–7 business days" : "Not applicable"],
            ],
            noteClass: "grey",
            noteText: "If you believe this is an error or would like to reschedule, please book a new appointment from your dashboard. We look forward to serving you.",
            btnClass: G.grey.btn,
            btnText: "Book a New Appointment",
            btnHref: `${FRONTEND_URL}/patient/book-appointment`,
        }),
    );
};

const notifyAppointmentOverdue = (patientEmail, { doctorName, date, timeSlot, refundInitiated }) => {
    sendNotification(patientEmail, "Appointment Request Expired — AyurAyush",
        buildEmail({
            headerClass: G.orange.hdr,
            title: "Appointment Request Expired",
            greeting: "Dear Patient,",
            message: "We sincerely apologise. Your appointment request was not reviewed by our admin team before the scheduled date. This is entirely our oversight and we are sorry for the inconvenience caused.",
            detailHeaderClass: G.orange.dh,
            detailTitle: "Expired Appointment",
            rows: [
                ["Doctor", `Dr. ${doctorName}`],
                ["Date", formatDate(date)],
                ["Time Slot", timeSlot],
                ["Refund", refundInitiated ? "Initiated — will reflect in 5–7 business days" : "Not applicable"],
            ],
            noteClass: "amber",
            noteText: "We understand this is frustrating. Please book a new appointment at your convenience — we will prioritise your request.",
            btnClass: G.orange.btn,
            btnText: "Book a New Appointment",
            btnHref: `${FRONTEND_URL}/patient/book-appointment`,
        }),
    );
};

const notifySubAdminOnboarded = (subAdminEmail, { subAdminName, temporaryPassword, loginUrl }) => {
    sendNotification(subAdminEmail, "Sub-Admin Account Ready — AyurAyush",
        buildEmail({
            headerClass: G.blue.hdr,
            title: "Sub-Admin Account Ready",
            greeting: `Dear ${subAdminName},`,
            message: "Your sub-admin account has been created by the hospital administration. You can now log in to the AyurAyush portal to manage your assigned queues and appointments.",
            detailHeaderClass: G.blue.dh,
            detailTitle: "Login Credentials",
            rows: [
                ["Name", subAdminName],
                ["Email", subAdminEmail],
                ["Temp Password", temporaryPassword],
            ],
            noteClass: "blue",
            noteText: "For security, please log in and change your password immediately. Your temporary password will expire after first use.",
            btnClass: G.blue.btn,
            btnText: "Login to Portal",
            btnHref: loginUrl,
        }),
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
    notifyPatientNotAttended,
    notifyAppointmentOverdue,
    notifySubAdminOnboarded,
};
