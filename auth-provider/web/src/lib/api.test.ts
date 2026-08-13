import { afterEach, describe, expect, it, vi } from "vitest";
import { apiJson } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiJson", () => {
  it("sends credentials and parses json response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }),
    );

    await expect(apiJson<{ ok: boolean }>("/admin/users")).resolves.toEqual({
      ok: true,
    });
    expect(fetch).toHaveBeenCalledWith(
      "/admin/users",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
