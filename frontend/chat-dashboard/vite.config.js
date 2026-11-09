import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],

    server: {
        host: "localhost",
        port: 5173,

        proxy: {
            "/auth": {
                target: "http://127.0.0.1:3003",
                changeOrigin: true
            },

            "/api": {
                target: "http://127.0.0.1:3002",
                changeOrigin: true
            }
        }
    }
});
