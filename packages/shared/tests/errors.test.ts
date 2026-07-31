import { describe, expect, it } from "vitest";
import { createStandardError } from "../src/errors";

describe("standard error helper", () => {
  it("returns the required error envelope", () => {
    expect(
      createStandardError(
        "INVALID_GRANT",
        "Authorization request tidak valid",
        "req-1",
      ),
    ).toEqual({
      error: {
        code: "INVALID_GRANT",
        message: "Authorization request tidak valid",
        requestId: "req-1",
      },
    });
  });
});
