import { afterEach, describe, expect, it, vi } from "vitest";
import { apiJson } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiJson", () => {
  it("returns undefined for empty 204 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
      }),
    );

    await expect(apiJson<void>("/logout", { method: "POST" })).resolves.toBeUndefined();
  });
});
