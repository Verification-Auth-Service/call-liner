import type { TimelineLaneViewModel } from "../domain-types";
import {
  getGridLaneRowStyle,
  getGridLineStyle,
  timelineStyles,
} from "../react-styles";

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
  const lines: Array<{ time: number; isMajor: boolean }> = [];

  for (let time = props.minTime; time <= props.maxTime; time += 100) {
    lines.push({
      time,
      isMajor: time % 500 === 0,
    });
  }

  return (
    <div className="timelineGridLayer" style={timelineStyles.gridLayer}>
      {props.lanes.map((lane, index) => (
        <div
          key={lane.key}
          className="timelineGridLaneRow"
          style={getGridLaneRowStyle(index * props.laneHeight, props.laneHeight, index)}
        />
      ))}

      {lines.map((line) => (
        <div
          key={line.time}
          className={line.isMajor ? "timelineGridMajorLine" : "timelineGridMinorLine"}
          style={getGridLineStyle(line.isMajor, props.timeToPx(line.time))}
        />
      ))}
    </div>
  );
}
