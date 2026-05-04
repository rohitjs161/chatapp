import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
    plugins: [react(), tailwindcss()],

    build: {
        minify: "terser",
        terserOptions: {
            compress: {
                drop_console: mode === "production", // ✅ CHANGED
                drop_debugger: true,
            },
        },
    },

    // ✅ NEW: Define global env usage safety
    define: {
        __APP_ENV__: JSON.stringify(mode),
    },

    // Only proxy in development — production uses VITE_API_URL directly
    server: mode === "development"
        ? {
            proxy: {
                "/api": {
                    target: "http://localhost:8000",
                    changeOrigin: true,
                    secure: false, // ✅ NEW (avoids HTTPS issues locally)
                },
            },
        }
        : {},

    // ✅ NEW: Preview config (important for testing production build)
    preview: {
        port: 5173,
        strictPort: true,
    },
}));