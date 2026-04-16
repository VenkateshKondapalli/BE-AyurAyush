const { Resend } = require("resend");
const logger = require("./logger");

const isEmailEnabled =
    (process.env.EMAIL_ENABLED || "true").toLowerCase() === "true";
let resendClient;

const getResendClient = () => {
    if (!resendClient) {
        resendClient = new Resend(process.env.RESEND_MAILER_API_KEY);
    }

    return resendClient;
};

const sendEmail = async (toEmail, subject, htmlText) => {
    if (!isEmailEnabled) {
        logger.info("Email sending skipped because EMAIL_ENABLED is false", {
            subject,
            to: toEmail,
        });
        return;
    }

    try {
        const resend = getResendClient();
        const { data, error } = await resend.emails.send({
            from: process.env.SENDER_EMAIL,
            to: toEmail,
            subject: subject,
            html: htmlText,
        });

        if (error) {
            throw new Error(error.message);
        }

        logger.debug("Email sent", {
            providerMessageId: data?.id,
            subject,
        });
    } catch (err) {
        logger.error("Error while sending email", {
            error: err.message,
            subject,
        });

        throw new Error("Email not sent");
    }
};

const sendOtpEmail = async (toEmail, otp) => {
    logger.info("Sending OTP email");
    await sendEmail(
        toEmail,
        "OTP Verification — AyurAyush",
        `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0fdf4;padding:1.5rem;}
    .card{max-width:480px;margin:0 auto;background:#fff;border-radius:1rem;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.12);}
    .hdr{padding:2rem;text-align:center;background:linear-gradient(135deg,#064e3b 0%,#065f46 60%,#047857 100%);}
    .brand{font-size:1.4rem;font-weight:800;letter-spacing:0.15em;color:#fff;text-transform:uppercase;}
    .hdivider{width:3rem;height:2px;background:rgba(255,255,255,0.4);margin:0.75rem auto;border-radius:2px;}
    .htitle{font-size:0.95rem;font-weight:600;color:rgba(255,255,255,0.92);letter-spacing:0.02em;}
    .body{padding:1.75rem 2rem;color:#374151;font-size:0.9rem;line-height:1.7;}
    .greeting{font-size:0.95rem;font-weight:600;color:#111827;margin-bottom:0.5rem;}
    .message{color:#4b5563;margin-bottom:1.25rem;}
    .otp-box{background:#f0fdf4;border:2px solid #059669;border-radius:0.75rem;padding:1.5rem;text-align:center;margin-bottom:1.25rem;}
    .otp-code{font-size:2.5rem;font-weight:800;letter-spacing:0.25em;color:#065f46;font-family:'Courier New',monospace;white-space:nowrap;display:block;}
    .otp-label{font-size:0.75rem;color:#6b7280;margin-top:0.4rem;}
    .note{border-radius:0.5rem;padding:0.875rem 1rem;font-size:0.85rem;margin-bottom:1.25rem;border-left:4px solid #059669;background:#f0fdf4;color:#065f46;}
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
      <div class="htitle">Verification Code</div>
    </div>
    <div class="body">
      <p class="greeting">Dear User,</p>
      <p class="message">Use the verification code below to complete your authentication. This code is valid for 10 minutes.</p>
      <div class="otp-box">
        <span class="otp-code">${otp}</span>
        <div class="otp-label">One-Time Password &nbsp;&bull;&nbsp; Valid for 10 minutes</div>
      </div>
      <div class="note">Do not share this code with anyone. AyurAyush will never ask for your OTP over call or message.</div>
    </div>
    <div class="footer">
      <div class="fbrand">AyurAyush Healthcare</div>
      <div class="fsub">Lovely Professional University &nbsp;&bull;&nbsp; &copy; ${new Date().getFullYear()}</div>
    </div>
  </div>
</body>
</html>`,
    );
};

module.exports = { sendEmail, sendOtpEmail };
