import type { PointerEvent } from "react";
import {
  getPlayheadLabelStyle,
  getPlayheadLineStyle,
  timelineStyles,
} from "../react-styles";

type TimelineCursorOverlayProps = {
  currentTime: number;
  timeToPx: (time: number) => number;
  isDragging: boolean;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
};

/**
 * playhead ラベルと縦線のオーバーレイを描画する。
 * 入力例: `<TimelineCursorOverlay currentTime={554} timeToPx={(t) => t} ... />`
 * 出力例: 同一座標系に重なる赤色 playhead。
 */
export function TimelineCursorOverlay(props: TimelineCursorOverlayProps) {
  const x = props.timeToPx(props.currentTime);

  return (
    <div
      className={`timelinePlayhead ${props.isDragging ? "isDragging" : ""}`}
      style={{ ...timelineStyles.playhead, left: x }}
    >
      <div
        className="timelinePlayheadLabel"
        style={getPlayheadLabelStyle(props.isDragging)}
        onPointerDown={props.onPointerDown}
      >
        {Math.round(props.currentTime)}
      </div>
      <div
        className="timelinePlayheadLine"
        style={getPlayheadLineStyle(props.isDragging)}
        onPointerDown={props.onPointerDown}
      />
    </div>
  );
}
