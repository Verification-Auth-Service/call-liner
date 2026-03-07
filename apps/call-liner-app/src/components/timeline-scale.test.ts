import { describe, expect, it } from "vitest";
import { createTimelineScale } from "./timeline-scale";

describe("createTimelineScale", () => {
  it("converts between time and pixel with shared equations", () => {
    const scale = createTimelineScale({ minTime: 100, pixelsPerUnit: 2 });

    expect(scale.timeToPx(300)).toBe(400);
    expect(scale.pxToTime(400)).toBe(300);
  });

  it("throws for invalid pixelsPerUnit", () => {
    expect(() => createTimelineScale({ minTime: 0, pixelsPerUnit: 0 })).toThrowError(
      /pixelsPerUnit must be greater than 0/,
    );
  });
});
