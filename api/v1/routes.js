const express = require("express");
const { authRouter } = require("./auth/routes");
const { otpRouter } = require("./otps/routes");
const { patientsRouter } = require("./patients/routes");
const { adminsRouter } = require("./admin/routes");
const { doctorsRouter } = require("./doctors/routes");
const { chatRouter } = require("./chat/routes");
const { treatmentsRouter } = require("./treatments/routes");
const { superAdminRouter } = require("./super-admin/routes");

const apiRouter = express.Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/otps", otpRouter);
apiRouter.use("/patient", patientsRouter);
apiRouter.use("/admin", adminsRouter);
apiRouter.use("/doctor", doctorsRouter);
apiRouter.use("/chat", chatRouter);
apiRouter.use("/treatments", treatmentsRouter);
apiRouter.use("/super-admin", superAdminRouter);

module.exports = { apiRouter };
