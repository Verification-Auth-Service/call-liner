import type {
  TimelineLaneKey,
  TimelineLaneViewModel,
  TimelineMarkerViewModel,
  TimelineSegmentViewModel,
} from "../domain-types";
import { getMarkerStyle, getSegmentStyle, timelineStyles } from "../react-styles";

type TimelineSegmentsProps = {
  segments: TimelineSegmentViewModel[];
  lanes: TimelineLaneViewModel[];
  laneHeight: number;
  timeToPx: (time: number) => number;
  markers: TimelineMarkerViewModel[];
};

const MIN_SEGMENT_WIDTH = 10;
const SEGMENT_HEIGHT = 34;

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
        const top = laneIndex * props.laneHeight + (props.laneHeight - SEGMENT_HEIGHT) / 2;

        return (
          <div
            key={segment.id}
            className={`timelineSegment tone-${segment.tone} kind-${segment.kind}`}
            style={getSegmentStyle(segment.tone, left, top, width, segment.kind === "event")}
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
