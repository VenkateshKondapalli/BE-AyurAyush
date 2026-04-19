const express = require("express");
const { getVerifiedDoctors } = require("../patients/services");
const logger = require("../../../utils/logger");

const publicRouter = express.Router();

// No auth — used by homepage specialists section
publicRouter.get("/doctors", async (req, res, next) => {
    try {
        const data = await getVerifiedDoctors("", { page: 1, limit: 8 });
        res.status(200).json({ isSuccess: true, data });
    } catch (err) {
        logger.error("Public doctors fetch failed", { error: err.message });
        next(err);
    }
});

module.exports = { publicRouter };
