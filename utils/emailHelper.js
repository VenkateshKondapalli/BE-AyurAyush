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
        "OTP Verification for AyurAyush HealthCare App",
        `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        body {
            background-color: #f3f4f6;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
        }
        .container {
            max-width: 28rem;
            width: 100%;
            margin: 0 auto;
        }
        .card {
            background-color: #ffffff;
            border-radius: 1rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background-color: #059669;
            color: white;
            text-align: center;
            padding: 1.5rem;
        }
        .header h1 {
            font-size: 1.875rem;
            font-weight: 700;
        }
        .content {
            padding: 2rem;
            text-align: center;
        }
        .content p {
            color: #4b5563;
            margin-bottom: 1rem;
        }
        .otp-box {
            background-color: #ecfdf5;
            border: 2px solid #059669;
            border-radius: 0.5rem;
            padding: 1.5rem 1rem;
        }
        .otp-box span {
            font-size: 3rem;
            font-weight: 700;
            color: #047857;
            letter-spacing: 0.05em;
        }
        .footer {
            background-color: #f9fafb;
            padding: 1rem 1.5rem;
            text-align: center;
            border-top: 1px solid #e5e7eb;
            font-size: 0.875rem;
            color: #4b5563;
        }
        .footer p {
            margin: 0.25rem 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="header">
                <h1>AyurAyush</h1>
            </div>
            
            <div class="content">
                <p>Your OTP for verification</p>
                <div class="otp-box">
                    <span>${otp}</span>
                </div>
            </div>
            
            <div class="footer">
                <p>AyurAyush, LPU</p>
                <p>Contact: XXX-XXX-XXXX</p>
            </div>
        </div>
    </div>
</body>
</html>
`,
    );
};

module.exports = { sendEmail, sendOtpEmail };
