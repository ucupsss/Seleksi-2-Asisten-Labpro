import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    proxy: {
      "/auth": process.env.AUTH_SERVER_URL ?? "http://localhost:4001",
      "^/admin/(session|users|groups|applications|memberships|policies|audit-logs|events)":
        process.env.AUTH_SERVER_URL ?? "http://localhost:4001",
      "/oauth": process.env.AUTH_SERVER_URL ?? "http://localhost:4001",
    },
  },
});
