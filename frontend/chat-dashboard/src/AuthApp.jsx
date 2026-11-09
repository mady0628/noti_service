import { useEffect, useState } from "react";

import App from "./App";
import Login from "./components/Login";

import {
    getMe,
    refreshAccessToken,
    logout
} from "./api/auth.api";

const REFRESH_INTERVAL = 12 * 60 * 1000;

const AuthApp = () => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // Dùng để yêu cầu SSE kết nối lại
    const [sessionVersion, setSessionVersion] =
        useState(0);

    // 1. Khi tải trang: kiểm tra session
    useEffect(() => {
        let cancelled = false;

        const initializeSession = async () => {
            try {
                let result;

                try {
                    result = await getMe();
                } catch (error) {
                    if (error.status !== 401) {
                        throw error;
                    }

                    // Access hết hạn: thử Refresh Token
                    result = await refreshAccessToken();
                }

                if (!cancelled) {
                    setUser(result.user);
                    setSessionVersion(v => v + 1);
                }

            } catch (error) {
                if (!cancelled) {
                    setUser(null);
                }

            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        initializeSession();

        return () => {
            cancelled = true;
        };
    }, []);

    // 2. Refresh trước khi Access hết hạn
    useEffect(() => {
        if (!user) return;

        let cancelled = false;

        const refreshSession = async () => {
            try {
                const result = await refreshAccessToken();

                if (!cancelled) {
                    setUser(result.user);
                    setSessionVersion(v => v + 1);
                }

            } catch (error) {
                console.error("Session refresh failed:", error);

                if (
                    !cancelled &&
                    (error.status === 401 || error.status === 403)
                ) {
                    setUser(null);
                }
            }
        };

        const intervalId = setInterval(
            refreshSession,
            REFRESH_INTERVAL
        );

        // Trở lại tab sau một thời gian:
        // kiểm tra lại phiên.
        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                refreshSession();
            }
        };

        document.addEventListener(
            "visibilitychange",
            handleVisibility
        );

        return () => {
            cancelled = true;
            clearInterval(intervalId);

            document.removeEventListener(
                "visibilitychange",
                handleVisibility
            );
        };
    }, [Boolean(user)]);

    // 3. Khi API báo refresh không còn hợp lệ
    useEffect(() => {
        const handleExpired = () => {
            setUser(null);
        };

        window.addEventListener(
            "auth:expired",
            handleExpired
        );

        return () => {
            window.removeEventListener(
                "auth:expired",
                handleExpired
            );
        };
    }, []);

    const handleLogout = async () => {
        try {
            await logout();
            setUser(null);

        } catch (error) {
            console.error("Logout failed:", error);
            // Không xác nhận đăng xuất thành công khi server
            // chưa thu hồi được refresh session.
        }
    };

    const handleLoginSuccess = (newUser) => {
        setUser(newUser);
        setSessionVersion(v => v + 1);
    };

    if (loading) {
        return (
            <div className="auth-loading">
                Đang kiểm tra phiên đăng nhập...
            </div>
        );
    }

    if (!user) {
        return (
            <Login onSuccess={handleLoginSuccess} />
        );
    }

    return (
        <App
            currentUser={user}
            onLogout={handleLogout}
            sessionVersion={sessionVersion}
        />
    );
};

export default AuthApp;

