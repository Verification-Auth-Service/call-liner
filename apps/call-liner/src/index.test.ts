import { describe, expect, it } from "vitest";
import { formatCallLine, parseCliArgs } from "./index";

describe("parseCliArgs", () => {
  it("parses call-liner entry args", () => {
    expect(parseCliArgs(["-d", "--client-entry", "/tmp/client.tsx", "--resource-entry", "/tmp/resource.ts"])).toEqual({
      debug: true,
      clientEntry: "/tmp/client.tsx",
      resourceEntry: "/tmp/resource.ts",
    });
  });

  it("throws when required entries are missing", () => {
    expect(() => parseCliArgs(["-d"])).toThrowError("使い方:");
  });
});
