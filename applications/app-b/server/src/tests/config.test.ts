import { describe, expect, it } from "vitest";
import { loadAppBConfig } from "../config.js";

describe("app b config", () => {
  it("uses App B SSO identity and callback defaults", () => {
    const config = loadAppBConfig({ INTERNAL_LOGOUT_SECRET: "internal-secret" });

    expect(config.appKey).toBe("app-b");
    expect(config.clientId).toBe("app-b-client");
    expect(config.redirectUri).toBe("http://localhost:4201/auth/callback");
    expect(config.localSessionCookieName).toBe("app_b_session");
  });
});
