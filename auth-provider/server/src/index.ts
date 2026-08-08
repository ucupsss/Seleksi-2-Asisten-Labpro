import { createAuthApp } from "./app.js";
import { loadAuthConfig } from "./config.js";

const config = loadAuthConfig();

createAuthApp().listen(config.port, () => {
  console.log(`auth-server listening on ${config.port}`);
});
