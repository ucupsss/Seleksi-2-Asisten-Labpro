import { afterEach, describe, expect, it, vi } from "vitest";
import { apiJson } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiJson", () => {
  it("throws standard error body when request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: "UNAUTHORIZED", message: "Unauthorized" },
        }),
      }),
    );

    await expect(apiJson("/session")).rejects.toEqual({
      error: { code: "UNAUTHORIZED", message: "Unauthorized" },
    });
  });
});
