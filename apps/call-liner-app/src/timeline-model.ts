export type TickMark = {
  time: number;
  isMajor: boolean;
};

export type TimelineMarker = {
  id: string;
  time: number;
};

export type TimelineSegment = {
  id: string;
  start: number;
  end: number;
  tone: "red" | "green";
};

export type TimelineLane = {
  id: string;
  name: string;
  segments: TimelineSegment[];
  markers: TimelineMarker[];
};

export type TimelineData = {
  maxTime: number;
  cursorTime: number;
  tickStep: number;
  majorStep: number;
  lanes: TimelineLane[];
};

/**
 * タイムライン目盛りを生成する。
 * 入力例: `buildTickMarks(1000, 100, 500)`
 * 出力例: `[{ time: 100, isMajor: false }, { time: 500, isMajor: true }, ...]`
 */
export function buildTickMarks(
  maxTime: number,
  step: number,
  majorStep: number,
): TickMark[] {
  // 0 以下の総時間は UI に描画できないため、即座に異常値として扱う。
  if (maxTime <= 0) {
    throw new RangeError("maxTime must be greater than 0.");
  }

  // 0 以下ステップでは無限ループになるため、異常値として拒否する。
  if (step <= 0) {
    throw new RangeError("step must be greater than 0.");
  }

  // majorStep も 0 以下だと主目盛り判定が破綻するため拒否する。
  if (majorStep <= 0) {
    throw new RangeError("majorStep must be greater than 0.");
  }

  const marks: TickMark[] = [];
  for (let time = step; time <= maxTime; time += step) {
    marks.push({ time, isMajor: time % majorStep === 0 });
  }

  return marks;
}

export const sampleTimelineData: TimelineData = {
  maxTime: 3000,
  cursorTime: 554,
  tickStep: 100,
  majorStep: 500,
  lanes: [
    {
      id: "lane-1",
      name: "OAuth Request",
      segments: [{ id: "seg-1", start: 0, end: 3000, tone: "red" }],
      markers: [],
    },
    {
      id: "lane-2",
      name: "Session Guard",
      segments: [{ id: "seg-2", start: 0, end: 3000, tone: "red" }],
      markers: [
        { id: "mark-1", time: 1700 },
        { id: "mark-2", time: 2050 },
      ],
    },
    {
      id: "lane-3",
      name: "Replay Detect",
      segments: [{ id: "seg-3", start: 0, end: 3000, tone: "red" }],
      markers: [
        { id: "mark-3", time: 180 },
        { id: "mark-4", time: 980 },
      ],
    },
    {
      id: "lane-4",
      name: "Policy Check",
      segments: [{ id: "seg-4", start: 0, end: 3000, tone: "red" }],
      markers: [{ id: "mark-5", time: 250 }, { id: "mark-6", time: 1340 }],
    },
    {
      id: "lane-5",
      name: "Trace",
      segments: [{ id: "seg-5", start: 0, end: 3000, tone: "green" }],
      markers: [],
    },
  ],
};
