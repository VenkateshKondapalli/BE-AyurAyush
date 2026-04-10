const jwt = require("jsonwebtoken");
const { ROLE_OPTIONS } = require("../../models/userSchema");
const { UserModel } = require("../../models/userSchema");
const logger = require("../../utils/logger");

const validateLoggedInUserMiddleware = (req, res, next) => {
    try {
        const { authorization } = req.cookies;

        if (!authorization) {
            logger.warn("Authorization token not present", {
                path: req.originalUrl,
                method: req.method,
            });
            res.status(401).json({
                isSuccess: false,
                message: "User not logged in!",
            });
            return;
        }

        jwt.verify(
            authorization,
            process.env.JWT_SECRET,
            { algorithms: ["HS256"] },
            async (err, data) => {
                if (err) {
                    logger.warn("Invalid token", {
                        path: req.originalUrl,
                        method: req.method,
                    });

                    return res.status(401).json({
                        isSuccess: false,
                        message: "User not logged in!",
                    });
                }

                try {
                    // Always hydrate roles from DB so authorization checks don't rely on stale JWT role claims.
                    const userDoc = await UserModel.findById(
                        data.userId,
                    ).select("roles isActive mustChangePassword");

                    if (!userDoc || userDoc.isActive === false) {
                        return res.status(401).json({
                            isSuccess: false,
                            message: "User not logged in!",
                        });
                    }

                    const hydratedUser = {
                        ...data,
                        roles: userDoc.roles || [],
                        mustChangePassword: !!userDoc.mustChangePassword,
                    };

                    logger.debug("Validated logged in user", {
                        userId: hydratedUser?.userId,
                        roles: hydratedUser?.roles,
                    });

                    req.currentUser = hydratedUser;
                    return next();
                } catch (dbErr) {
                    logger.error(
                        "Error loading user roles in auth middleware",
                        {
                            error: dbErr.message,
                        },
                    );

                    return res.status(500).json({
                        isSuccess: false,
                        message: "Internal Server Error",
                    });
                }
            },
        );
    } catch (err) {
        logger.error("Error in validateLoggedInUserMiddleware", {
            error: err.message,
        });

        res.status(500).json({
            isSuccess: false,
            message: "Internal Server Error",
        });
    }
};

const validateIsAdminMiddleware = (req, res, next) => {
    try {
        const { roles } = req.currentUser;

        if (roles && roles.includes(ROLE_OPTIONS.ADMIN)) {
            req.currentAdmin = req.currentUser;
            next();
        } else {
            return res.status(403).json({
                isSuccess: false,
                message: "User is not an admin",
            });
        }
    } catch (err) {
        logger.error("Error in validateIsAdminMiddleware", {
            error: err.message,
        });

        res.status(500).json({
            isSuccess: false,
            message: "Internal Server Error",
        });
    }
};

const validatePatientRole = (req, res, next) => {
    try {
        const { roles } = req.currentUser;

        if (roles && roles.includes(ROLE_OPTIONS.PATIENT)) {
            req.currentPatient = req.currentUser;
            next();
        } else {
            return res.status(403).json({
                isSuccess: false,
                message: "Patient access only",
            });
        }
    } catch (err) {
        logger.error("Error in validatePatientRole", {
            error: err.message,
        });

        res.status(500).json({
            isSuccess: false,
            message: "Internal Server Error",
        });
    }
};

const validatePatientOrAdminRole = (req, res, next) => {
    try {
        const { roles } = req.currentUser;

        if (
            roles &&
            (roles.includes(ROLE_OPTIONS.PATIENT) ||
                roles.includes(ROLE_OPTIONS.ADMIN))
        ) {
            if (roles.includes(ROLE_OPTIONS.PATIENT)) {
                req.currentPatient = req.currentUser;
            }
            if (roles.includes(ROLE_OPTIONS.ADMIN)) {
                req.currentAdmin = req.currentUser;
            }
            return next();
        }

        return res.status(403).json({
            isSuccess: false,
            message: "Patient or admin access only",
        });
    } catch (err) {
        logger.error("Error in validatePatientOrAdminRole", {
            error: err.message,
        });

        return res.status(500).json({
            isSuccess: false,
            message: "Internal Server Error",
        });
    }
};

const validateDoctorRole = (req, res, next) => {
    try {
        const { roles } = req.currentUser;

        if (roles && roles.includes(ROLE_OPTIONS.DOCTOR)) {
            req.currentDoctor = req.currentUser;
            next();
        } else {
            return res.status(403).json({
                isSuccess: false,
                message: "Doctor access only",
            });
        }
    } catch (err) {
        logger.error("Error in validateDoctorRole", {
            error: err.message,
        });

        res.status(500).json({
            isSuccess: false,
            message: "Internal Server Error",
        });
    }
};

module.exports = {
    validateLoggedInUserMiddleware,
    validateIsAdminMiddleware,
    validatePatientRole,
    validatePatientOrAdminRole,
    validateDoctorRole,
};
