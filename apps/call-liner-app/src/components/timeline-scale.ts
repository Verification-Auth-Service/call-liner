export type TimelineScale = {
  timeToPx: (time: number) => number;
  pxToTime: (px: number) => number;
};

/**
 * タイムライン座標変換関数を生成する。
 * 入力例: `createTimelineScale({ minTime: 0, pixelsPerUnit: 1 })`
 * 出力例: `{ timeToPx(554) => 554, pxToTime(250) => 250 }`
 */
export function createTimelineScale(params: {
  minTime: number;
  pixelsPerUnit: number;
}): TimelineScale {
  const { minTime, pixelsPerUnit } = params;

  // 0 以下のスケールでは座標変換が破綻するため異常値として拒否する。
  if (pixelsPerUnit <= 0) {
    throw new RangeError("pixelsPerUnit must be greater than 0.");
  }

  return {
    timeToPx: (time: number) => (time - minTime) * pixelsPerUnit,
    pxToTime: (px: number) => minTime + px / pixelsPerUnit,
  };
}
