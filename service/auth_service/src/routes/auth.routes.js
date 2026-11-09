const express = require("express");

const controller = require(
    "../controllers/auth.controller"
);

const trustedOrigin = require(
    "../middlewares/trusted-origin.middleware"
);

const router = express.Router();

router.post(
    "/login",
    trustedOrigin,
    controller.login
);

router.post(
    "/refresh",
    trustedOrigin,
    controller.refresh
);

router.post(
    "/logout",
    trustedOrigin,
    controller.logout
);

router.get("/me", controller.me);

module.exports = router;

