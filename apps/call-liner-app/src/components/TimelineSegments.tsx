import type {
  TimelineLaneKey,
  TimelineLaneViewModel,
  TimelineMarkerViewModel,
  TimelineSegmentViewModel,
} from "../domain-types";

type TimelineSegmentsProps = {
  segments: TimelineSegmentViewModel[];
  lanes: TimelineLaneViewModel[];
  laneHeight: number;
  timeToPx: (time: number) => number;
  markers: TimelineMarkerViewModel[];
};

const MIN_SEGMENT_WIDTH = 10;
const SEGMENT_HEIGHT = 22;

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
    <div className="timelineSegmentsLayer">
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
            style={{ left, top, width }}
            title={segment.label}
          >
            <span className="timelineSegmentLabel">{segment.label}</span>
          </div>
        );
      })}

      {props.markers.map((marker) => {
        const laneIndex = laneIndexMap.get(marker.laneKey) ?? 0;

        return (
          <span
            key={marker.id}
            className="timelineMarker"
            style={{ left: props.timeToPx(marker.atMs), top: laneIndex * props.laneHeight }}
          >
            {marker.label ? <small>{marker.label}</small> : null}
          </span>
        );
      })}
    </div>
  );
}
