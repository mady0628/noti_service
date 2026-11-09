import React from "react";
import ReactDOM from "react-dom/client";

import AuthApp from "./AuthApp";

import "./index.css";
import "./login.css";

ReactDOM.createRoot(
    document.getElementById("root")
).render(
    <React.StrictMode>
        <AuthApp />
    </React.StrictMode>
);
