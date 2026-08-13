import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/login": "http://localhost:4101",
      "/session": "http://localhost:4101",
      "/logout": "http://localhost:4101",
    },
  },
});
