import type {
  TimelineLaneKey,
  TimelineLaneViewModel,
  TimelineMarkerViewModel,
  TimelineSegmentViewModel,
} from "../domain-types";
import {
  getMarkerStyle,
  getSegmentStyle,
  getStateChipStyle,
  timelineStyles,
} from "../react-styles";

type TimelineSegmentsProps = {
  segments: TimelineSegmentViewModel[];
  lanes: TimelineLaneViewModel[];
  laneHeight: number;
  timeToPx: (time: number) => number;
  markers: TimelineMarkerViewModel[];
};

const MIN_SEGMENT_WIDTH = 10;
const SEGMENT_HEIGHT = 34;
const STATE_CHIP_HEIGHT = 14;
const STATE_CHIP_TOP = 6;
const STATE_CHIP_GAP = 4;

/**
 * 同一座標系でセグメントとマーカーを描画する。
 * 入力例: `<TimelineSegments segments={[...]} lanes={[...]} laneHeight={48} ... />`
 * 出力例: レーン中央配置のバー群とマーカー群。
 */
export function TimelineSegments(props: TimelineSegmentsProps) {
  const laneIndexMap = new Map<TimelineLaneKey, number>(
    props.lanes.map((lane, index) => [lane.key, index]),
  );

  return (
    <div className="timelineSegmentsLayer" style={timelineStyles.segmentsLayer}>
      {props.segments.map((segment) => {
        const laneIndex = laneIndexMap.get(segment.laneKey) ?? 0;
        const left = props.timeToPx(segment.startMs);
        const width = Math.max(
          MIN_SEGMENT_WIDTH,
          props.timeToPx(segment.startMs + segment.durationMs) - left,
        );
        const top =
          segment.kind === "chip"
            ? laneIndex * props.laneHeight +
              STATE_CHIP_TOP +
              (segment.stackIndex ?? 0) * (STATE_CHIP_HEIGHT + STATE_CHIP_GAP)
            : laneIndex * props.laneHeight + (props.laneHeight - SEGMENT_HEIGHT) / 2;
        const style =
          segment.kind === "chip"
            ? getStateChipStyle(left, top, width)
            : getSegmentStyle(segment.tone, left, top, width, segment.kind === "event");

        return (
          <div
            key={segment.id}
            className={`timelineSegment tone-${segment.tone} kind-${segment.kind}`}
            style={style}
            title={segment.label}
          >
            <span className="timelineSegmentLabel" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {segment.label}
            </span>
          </div>
        );
      })}

      {props.markers.map((marker) => {
        const laneIndex = laneIndexMap.get(marker.laneKey) ?? 0;

        return (
          <span
            key={marker.id}
            className="timelineMarker"
            style={getMarkerStyle(props.timeToPx(marker.atMs), laneIndex * props.laneHeight)}
          >
            {marker.label ? (
              <small
                style={{
                  position: "absolute",
                  top: "-20px",
                  left: "7px",
                  transform: "none",
                  whiteSpace: "nowrap",
                  fontSize: "11px",
                  color: "#d4dfed",
                  textShadow: "0 1px 0 rgba(0, 0, 0, 0.45)",
                }}
              >
                {marker.label}
              </small>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
