import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    proxy: {
      "/auth": "http://localhost:4001",
      "/admin": "http://localhost:4001",
      "/oauth": "http://localhost:4001",
    },
  },
});
