import {
    refreshAccessToken
} from "./auth.api";

export const apiRequest = async (
    url,
    options = {}
) => {
    const execute = () => fetch(url, {
        ...options,
        credentials: "same-origin"
    });

    let response = await execute();

    // Access Token hết hạn
    if (response.status === 401) {
        try {
            await refreshAccessToken();
        } catch (error) {
            if (error.status === 401 || error.status === 403) {
                window.dispatchEvent(
                    new Event("auth:expired")
                );
            }

            throw error;
        }

        // Retry request ban đầu đúng một lần
        response = await execute();
    }

    const result = await response.json();

    if (!response.ok || !result.success) {
        const error = new Error(
            result.message || `HTTP ${response.status}`
        );

        error.status = response.status;
        throw error;
    }

    return result;
};

