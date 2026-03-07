import type { TimelineLaneViewModel } from "../domain-types";
import { getLaneLabelRowStyle, timelineStyles } from "../react-styles";

type TimelineLaneLabelsProps = {
  lanes: TimelineLaneViewModel[];
  laneHeight: number;
};

/**
 * 左固定列のレーンラベルを描画する。
 * 入力例: `<TimelineLaneLabels lanes={[{ key: "request", label: "Request", description: "..." }]} laneHeight={48} />`
 * 出力例: 横スクロールしないレーン名カラム。
 */
export function TimelineLaneLabels(props: TimelineLaneLabelsProps) {
  return (
    <div className="timelineLaneLabels" style={timelineStyles.laneLabels}>
      {props.lanes.map((lane, index) => (
        <div key={lane.key} className="timelineLaneLabelRow" style={getLaneLabelRowStyle(index, props.laneHeight)}>
          {lane.label}
        </div>
      ))}
    </div>
  );
}
