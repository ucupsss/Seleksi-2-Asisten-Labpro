import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4100,
    proxy: {
      "/login": process.env.APP_A_SERVER_URL ?? "http://localhost:4101",
      "/session": process.env.APP_A_SERVER_URL ?? "http://localhost:4101",
      "/logout": process.env.APP_A_SERVER_URL ?? "http://localhost:4101",
      "/activity-logs": process.env.APP_A_SERVER_URL ?? "http://localhost:4101",
      "/processed-events": process.env.APP_A_SERVER_URL ?? "http://localhost:4101",
    },
  },
});
