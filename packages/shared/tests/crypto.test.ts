import { describe, expect, it } from "vitest";
import { randomToken, sha256Hex } from "../src/crypto";

describe("crypto helpers", () => {
  it("hashes values as stable sha256 hex", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("creates different random tokens", () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});
