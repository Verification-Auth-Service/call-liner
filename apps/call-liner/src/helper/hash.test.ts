import { describe, expect, it } from "vitest";
import { hashString } from "~/helper/hash";

describe("hashString", () => {
  it("returns deterministic sha256 hex for a string", () => {
    expect(hashString("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("throws when input is empty", () => {
    expect(() => hashString("")).toThrowError(
      "ハッシュ化する文字列は1文字以上で指定してください。",
    );
  });
});
