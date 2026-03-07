import { forwardRef } from "react";
import { timelineStyles } from "../react-styles";

type TimelineHeaderProps = {
  minTime: number;
  maxTime: number;
  pixelsPerUnit: number;
  totalWidth: number;
};

/**
 * 左上固定セルと時間ルーラーを描画する。
 * 入力例: `<TimelineHeader minTime={0} maxTime={1700} pixelsPerUnit={1} totalWidth={1700} ... />`
 * 出力例: 左固定 corner と横スクロール同期対象のヘッダ。
 */
export const TimelineHeader = forwardRef<HTMLDivElement, TimelineHeaderProps>(
  function TimelineHeader(props, ref) {
    const ticks: number[] = [];

    for (let time = props.minTime; time <= props.maxTime; time += 100) {
      ticks.push(time);
    }

    return (
      <div className="timelineHeaderRow" style={timelineStyles.headerRow}>
        <div className="timelineHeaderCorner" style={timelineStyles.headerCorner}>Layers</div>
        <div className="timelineHeaderScrollViewport" style={timelineStyles.headerViewport} ref={ref}>
          <div className="timelineHeaderContent" style={{ ...timelineStyles.headerContent, width: props.totalWidth }}>
            {ticks.map((time) => (
              <div
                key={time}
                className="timelineHeaderTick"
                style={{ ...timelineStyles.headerTick, left: (time - props.minTime) * props.pixelsPerUnit }}
              >
                {time}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  },
);
