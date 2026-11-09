const jwt = require("jsonwebtoken");

const authService = require("../services/auth.service");
const tokenService = require("../services/token.service");

const ACCESS_COOKIE = "mc_access";
const REFRESH_COOKIE = "mc_refresh";

const setAuthCookies = (res, tokens) => {
    res.cookie(
        ACCESS_COOKIE,
        tokens.accessToken,
        tokenService.accessCookieOptions()
    );

    res.cookie(
        REFRESH_COOKIE,
        tokens.refreshToken,
        tokenService.refreshCookieOptions()
    );
};

const clearAuthCookies = (res) => {
    const isProduction =
        process.env.NODE_ENV === "production";

    res.clearCookie(ACCESS_COOKIE, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        path: "/"
    });

    res.clearCookie(REFRESH_COOKIE, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        path: "/auth"
    });
};

const sendError = (res, error) => {
    console.error("Auth error:", error.message);

    return res.status(error.statusCode || 500).json({
        success: false,
        message: error.statusCode
            ? error.message
            : "Internal server error"
    });
};

// POST /auth/login
const login = async (req, res) => {
    try {
        const { username, password } = req.body || {};

        if (
            typeof username !== "string" ||
            !username.trim() ||
            username.length > 200 ||
            typeof password !== "string" ||
            !password ||
            password.length > 1024
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid credentials format"
            });
        }

        const result = await authService.login(
            username.trim(),
            password
        );

        setAuthCookies(res, result);

        return res.status(200).json({
            success: true,
            data: {
                user: result.user
            }
        });

    } catch (error) {
        return sendError(res, error);
    }
};

// POST /auth/refresh
const refresh = async (req, res) => {
    try {
        const refreshToken =
            req.cookies?.[REFRESH_COOKIE];

        if (
            typeof refreshToken !== "string" ||
            !/^[0-9a-f]{64}$/.test(refreshToken)
        ) {
            clearAuthCookies(res);

            return res.status(401).json({
                success: false,
                message: "Refresh token required"
            });
        }

        const result = await authService.refresh(
            refreshToken
        );

        setAuthCookies(res, result);

        return res.status(200).json({
            success: true,
            data: {
                user: result.user
            }
        });

    } catch (error) {
        if (error.statusCode === 401) {
            clearAuthCookies(res);
        }

        return sendError(res, error);
    }
};

// GET /auth/me
const me = async (req, res) => {
    try {
        const accessToken =
            req.cookies?.[ACCESS_COOKIE];

        if (!accessToken) {
            return res.status(401).json({
                success: false,
                message: "Not authenticated"
            });
        }

        const payload = jwt.verify(
            accessToken,
            process.env.JWT_SECRET,
            {
                algorithms: ["HS256"],
                issuer: process.env.JWT_ISSUER,
                audience: process.env.JWT_AUDIENCE
            }
        );

        const user = await authService.getCurrentUser(
            payload.sub
        );

        return res.status(200).json({
            success: true,
            data: { user }
        });

    } catch {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired session"
        });
    }
};

// POST /auth/logout
const logout = async (req, res) => {
    try {
        const refreshToken =
            req.cookies?.[REFRESH_COOKIE];

        await authService.logout(refreshToken);

        clearAuthCookies(res);

        return res.status(200).json({
            success: true,
            message: "Logged out successfully"
        });

    } catch (error) {
        return sendError(res, error);
    }
};

module.exports = {
    login,
    refresh,
    me,
    logout
};

