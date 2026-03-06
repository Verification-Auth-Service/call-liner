import { describe, expect, it } from "vitest";
import { buildTickMarks } from "./timeline-model";

describe("buildTickMarks", () => {
  it("creates timeline ticks with major flags", () => {
    expect(buildTickMarks(500, 100, 300)).toEqual([
      { time: 100, isMajor: false },
      { time: 200, isMajor: false },
      { time: 300, isMajor: true },
      { time: 400, isMajor: false },
      { time: 500, isMajor: false },
    ]);
  });

  it("throws when step is invalid", () => {
    expect(() => buildTickMarks(500, 0, 200)).toThrowError(RangeError);
  });
});
