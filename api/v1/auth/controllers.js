const {
    signupUser,
    loginUser,
    checkEmailExists,
    forgotPassword,
    resetPassword,
    changePasswordForLoggedInUser,
} = require("./services");
const { sendOtp } = require("../otps/services");
const { UserModel } = require("../../../models/userSchema");

const userSignupController = async (req, res, next) => {
    try {
        const { name, email, phone, gender, dob, password } = req.body;

        const user = await signupUser({
            name,
            email,
            phone,
            gender,
            dob,
            password,
        });

        res.status(201).json({
            isSuccess: true,
            message: "User Created!",
            data: { user },
        });
    } catch (err) {
        next(err);
    }
};

const userLoginController = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const { token, name, roles, mustChangePassword } = await loginUser({
            email,
            password,
        });

        res.cookie("authorization", token, {
            httpOnly: true,
            sameSite: "none",
            secure: true,
            maxAge: 1 * 24 * 60 * 60 * 1000,
        });

        res.status(200).json({
            isSuccess: true,
            message: "User logged in!",
            data: { name, roles, mustChangePassword },
        });
    } catch (err) {
        next(err);
    }
};

const userLogoutController = async (req, res, next) => {
    try {
        res.cookie("authorization", "", {
            httpOnly: true,
            sameSite: "None",
            secure: true,
            maxAge: 0,
        });

        res.status(200).json({
            isSuccess: true,
            message: "User logged out!",
        });
    } catch (err) {
        next(err);
    }
};

const getCurrentUserController = async (req, res, next) => {
    try {
        const { userId } = req.currentUser;
        const user = await UserModel.findById(userId).select(
            "name roles mustChangePassword",
        );

        if (!user) {
            return res.status(404).json({
                isSuccess: false,
                message: "User not found",
            });
        }

        res.status(200).json({
            isSuccess: true,
            data: {
                userId,
                name: user.name,
                roles: user.roles,
                mustChangePassword: !!user.mustChangePassword,
            },
        });
    } catch (err) {
        next(err);
    }
};

const checkEmailExistsController = async (req, res, next) => {
    try {
        const { email } = req.query;
        const exists = await checkEmailExists(email);
        res.status(200).json({ exists });
    } catch (err) {
        next(err);
    }
};

const forgotPasswordController = async (req, res, next) => {
    try {
        const { email } = req.body;
        await forgotPassword(email);
        const expiryMinutes = await sendOtp(email);
        res.status(200).json({
            isSuccess: true,
            message: `OTP sent to ${email}. Valid for ${expiryMinutes} minutes.`,
        });
    } catch (err) {
        next(err);
    }
};

const resetPasswordController = async (req, res, next) => {
    try {
        const { email, newPassword } = req.body;
        await resetPassword(email, newPassword);
        res.status(200).json({
            isSuccess: true,
            message:
                "Password reset successfully. You can now login with your new password.",
        });
    } catch (err) {
        next(err);
    }
};

const changePasswordController = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;

        await changePasswordForLoggedInUser(
            req.currentUser.userId,
            currentPassword,
            newPassword,
        );

        res.status(200).json({
            isSuccess: true,
            message: "Password updated successfully.",
        });
    } catch (err) {
        next(err);
    }
};

module.exports = {
    userSignupController,
    userLoginController,
    userLogoutController,
    getCurrentUserController,
    checkEmailExistsController,
    forgotPasswordController,
    resetPasswordController,
    changePasswordController,
};
