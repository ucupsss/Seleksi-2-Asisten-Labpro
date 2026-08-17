import { describe, expect, it } from "vitest";
import { getApiErrorCode, getSafeReturnTo } from "./admin-auth.js";

describe("admin authentication helpers", () => {
  it("keeps only same-origin login continuation targets", () => {
    expect(
      getSafeReturnTo("/oauth/authorize?client_id=app-a", "http://localhost:4000"),
    ).toBe("/oauth/authorize?client_id=app-a");
    expect(getSafeReturnTo("https://evil.example", "http://localhost:4000"))
      .toBeNull();
    expect(getSafeReturnTo("//evil.example/admin", "http://localhost:4000"))
      .toBeNull();
  });

  it("reads standard API error codes", () => {
    expect(
      getApiErrorCode({ error: { code: "FORBIDDEN", message: "denied" } }),
    ).toBe("FORBIDDEN");
    expect(getApiErrorCode(new Error("network"))).toBeNull();
  });
});
