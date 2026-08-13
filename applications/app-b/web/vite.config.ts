import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/login": "http://localhost:4102",
      "/session": "http://localhost:4102",
      "/logout": "http://localhost:4102",
    },
  },
});
