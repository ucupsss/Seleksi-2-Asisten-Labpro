import { describe, expect, it } from "vitest";
import { loadAppAConfig } from "../config.js";

describe("app a config", () => {
  it("uses App A SSO identity and callback defaults", () => {
    const config = loadAppAConfig();

    expect(config.appKey).toBe("app-a");
    expect(config.clientId).toBe("app-a-client");
    expect(config.redirectUri).toBe("http://localhost:4101/auth/callback");
    expect(config.localSessionCookieName).toBe("app_a_session");
  });
});
