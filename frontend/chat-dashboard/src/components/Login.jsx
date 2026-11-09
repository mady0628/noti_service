import { useState } from "react";
import { login } from "../api/auth.api";

const Login = ({ onSuccess }) => {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!username.trim() || !password) return;

        try {
            setLoading(true);
            setError("");

            const result = await login(
                username.trim(),
                password
            );

            onSuccess(result.user);

        } catch (error) {
            setError(
                "Sai thông tin đăng nhập hoặc tài khoản không hợp lệ."
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <form
                className="login-card"
                onSubmit={handleSubmit}
            >
                <h1>Multi-Channel Chat</h1>
                <p>Đăng nhập hệ thống quản lý tin nhắn</p>

                <label htmlFor="login-username">
                    Username hoặc Email
                </label>

                <input
                    id="login-username"
                    type="text"
                    value={username}
                    onChange={(event) =>
                        setUsername(event.target.value)
                    }
                    autoComplete="username"
                    required
                />

                <label htmlFor="login-password">
                    Mật khẩu
                </label>

                <input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(event) =>
                        setPassword(event.target.value)
                    }
                    autoComplete="current-password"
                    required
                />

                {error && (
                    <p className="login-error">{error}</p>
                )}

                <button type="submit" disabled={loading}>
                    {loading
                        ? "Đang đăng nhập..."
                        : "Đăng nhập"}
                </button>
            </form>
        </div>
    );
};

export default Login;

