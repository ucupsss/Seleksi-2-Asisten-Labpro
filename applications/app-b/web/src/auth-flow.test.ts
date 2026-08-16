import { describe, expect, it } from "vitest";
import { nextAuthPhase } from "./App.js";

describe("App B auth flow", () => {
  it("redirects an anonymous visitor instead of showing the dashboard", () => {
    expect(nextAuthPhase("checking", "anonymous")).toBe("redirecting");
  });

  it("shows the dashboard only for an authenticated session", () => {
    expect(nextAuthPhase("checking", "authenticated")).toBe("authenticated");
  });

  it("keeps the signed-out screen after local logout", () => {
    expect(nextAuthPhase("signed-out", "anonymous")).toBe("signed-out");
  });

  it("restores the signed-out screen after the page is refreshed", () => {
    expect(nextAuthPhase("checking", "anonymous", true)).toBe("signed-out");
  });
});
