import { createAppB } from "./app.js";
import { loadAppBConfig } from "./config.js";

const config = loadAppBConfig();
const app = createAppB();

app.listen(config.port, () => {
  console.log(`${config.appName} server listening on port ${config.port}`);
});
