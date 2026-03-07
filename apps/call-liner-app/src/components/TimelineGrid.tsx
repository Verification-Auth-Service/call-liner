import type { TimelineLaneViewModel } from "../domain-types";

type TimelineGridProps = {
  lanes: TimelineLaneViewModel[];
  laneHeight: number;
  minTime: number;
  maxTime: number;
  timeToPx: (time: number) => number;
};

/**
 * タイムラインの背景グリッドを描画する。
 * 入力例: `<TimelineGrid lanes={[...]} laneHeight={48} minTime={0} maxTime={1700} ... />`
 * 出力例: レーン背景と縦グリッド線を重ねたレイヤー。
 */
export function TimelineGrid(props: TimelineGridProps) {
  const lines: Array<{ time: number; className: string }> = [];

  for (let time = props.minTime; time <= props.maxTime; time += 100) {
    lines.push({
      time,
      className: time % 500 === 0 ? "timelineGridMajorLine" : "timelineGridMinorLine",
    });
  }

  return (
    <div className="timelineGridLayer">
      {props.lanes.map((lane, index) => (
        <div
          key={lane.key}
          className="timelineGridLaneRow"
          style={{ top: index * props.laneHeight, height: props.laneHeight }}
        />
      ))}

      {lines.map((line) => (
        <div
          key={line.time}
          className={line.className}
          style={{ left: props.timeToPx(line.time) }}
        />
      ))}
    </div>
  );
}
