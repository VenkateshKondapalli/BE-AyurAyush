const express = require("express");
const {
    validateLoggedInUserMiddleware,
    validateSuperAdminMiddleware,
} = require("../middlewares");
const {
    getSuperAdminDashboardController,
    createSubAdminController,
    listSubAdminsController,
    updateSubAdminController,
    deactivateSubAdminController,
} = require("./controllers");

const superAdminRouter = express.Router();

// All routes require logged-in + super-admin (existing "admin" role)
superAdminRouter.use(validateLoggedInUserMiddleware, validateSuperAdminMiddleware);

superAdminRouter.get("/dashboard", getSuperAdminDashboardController);
superAdminRouter.get("/sub-admins", listSubAdminsController);
superAdminRouter.post("/sub-admins", createSubAdminController);
superAdminRouter.put("/sub-admins/:profileId", updateSubAdminController);
superAdminRouter.delete("/sub-admins/:profileId", deactivateSubAdminController);

module.exports = { superAdminRouter };
