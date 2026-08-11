import { createAppA } from "./app.js";
import { loadAppAConfig } from "./config.js";

const config = loadAppAConfig();
const app = createAppA();

app.listen(config.port, () => {
  console.log(`${config.appName} server listening on port ${config.port}`);
});
