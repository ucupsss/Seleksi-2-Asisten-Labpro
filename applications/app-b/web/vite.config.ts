import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4200,
    proxy: {
      "/login": process.env.APP_B_SERVER_URL ?? "http://localhost:4201",
      "/session": process.env.APP_B_SERVER_URL ?? "http://localhost:4201",
      "/logout": process.env.APP_B_SERVER_URL ?? "http://localhost:4201",
      "/activity-logs": process.env.APP_B_SERVER_URL ?? "http://localhost:4201",
      "/processed-events": process.env.APP_B_SERVER_URL ?? "http://localhost:4201",
    },
  },
});
