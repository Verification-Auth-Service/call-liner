import { describe, expect, it } from "vitest";
import { formatCallLine } from "./index";

describe("formatCallLine", () => {
  it("formats a name and phone number", () => {
    expect(formatCallLine("Bob", "+1-555-0101")).toBe("Bob: +1-555-0101");
  });
});

