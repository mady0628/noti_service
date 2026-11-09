let refreshPromise = null;

// Login
export const login = async (username, password) => {
    const response = await fetch("/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username,
            password
        })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
        throw new Error(
            result.message || "Login failed"
        );
    }

    return result.data;
};

// Refresh token.
// Nếu nhiều request cùng refresh, chỉ gọi một lần.
export const refreshAccessToken = () => {
    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = (async () => {
        const response = await fetch("/auth/refresh", {
            method: "POST",
            credentials: "same-origin"
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            const error = new Error(
                result.message || "Refresh failed"
            );

            error.status = response.status;
            throw error;
        }

        return result.data;
    })();

    refreshPromise.finally(() => {
        refreshPromise = null;
    }).catch(() => {});

    return refreshPromise;
};

// Get current user
export const getMe = async () => {
    const response = await fetch("/auth/me", {
        credentials: "same-origin"
    });

    if (!response.ok) {
        const error = new Error("Session invalid");
        error.status = response.status;
        throw error;
    }

    const result = await response.json();
    return result.data;
};

// Logout
export const logout = async () => {
    const response = await fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin"
    });

    if (!response.ok) {
        throw new Error("Logout failed");
    }
};

