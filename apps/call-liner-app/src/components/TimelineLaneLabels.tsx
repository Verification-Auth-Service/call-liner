import type { TimelineLaneViewModel } from "../domain-types";

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
    <div className="timelineLaneLabels">
      {props.lanes.map((lane) => (
        <div key={lane.key} className="timelineLaneLabelRow" style={{ height: props.laneHeight }}>
          {lane.label}
        </div>
      ))}
    </div>
  );
}
