const {
    createSubAdmin,
    listSubAdmins,
    updateSubAdmin,
    deactivateSubAdmin,
    getSuperAdminDashboard,
} = require("./services");

const getSuperAdminDashboardController = async (req, res, next) => {
    try {
        const data = await getSuperAdminDashboard();
        res.status(200).json({ isSuccess: true, data });
    } catch (err) { next(err); }
};

const createSubAdminController = async (req, res, next) => {
    try {
        const data = await createSubAdmin(req.currentUser.userId, req.body);
        res.status(201).json({ isSuccess: true, data });
    } catch (err) { next(err); }
};

const listSubAdminsController = async (req, res, next) => {
    try {
        const data = await listSubAdmins();
        res.status(200).json({ isSuccess: true, data });
    } catch (err) { next(err); }
};

const updateSubAdminController = async (req, res, next) => {
    try {
        const data = await updateSubAdmin(req.params.profileId, req.body);
        res.status(200).json({ isSuccess: true, data });
    } catch (err) { next(err); }
};

const deactivateSubAdminController = async (req, res, next) => {
    try {
        const data = await deactivateSubAdmin(req.params.profileId);
        res.status(200).json({ isSuccess: true, data });
    } catch (err) { next(err); }
};

module.exports = {
    getSuperAdminDashboardController,
    createSubAdminController,
    listSubAdminsController,
    updateSubAdminController,
    deactivateSubAdminController,
};
