const { sendOtp } = require("./services");

const sendOtpController = async (req, res, next) => {
  try {
    const { email } = req.body;
    const expiryMinutes = await sendOtp(email);

    res.status(201).json({
      isSuccess: true,
      message: `OTP sent! It expires in ${expiryMinutes} minutes.`,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { sendOtpController };
