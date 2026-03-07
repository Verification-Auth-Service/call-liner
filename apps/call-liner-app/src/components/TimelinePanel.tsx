import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { ScenarioTimelineViewModel } from "../domain-types";
import { createTimelineScale } from "./timeline-scale";
import { TimelineHeader } from "./TimelineHeader";
import { TimelineLaneLabels } from "./TimelineLaneLabels";
import { TimelineScrollable } from "./TimelineScrollable";

type TimelinePanelProps = {
  vm: ScenarioTimelineViewModel;
};

const PIXELS_PER_UNIT = 1;
const LANE_HEIGHT = 48;

/**
 * タイムライン全体の状態管理とスクロール同期を担当する。
 * 入力例: `<TimelinePanel vm={timelineViewModel} />`
 * 出力例: 左固定列、ヘッダ、スクロール本体が責務分離されたタイムライン。
 */
export function TimelinePanel(props: TimelinePanelProps) {
  const [currentTime, setCurrentTime] = useState(props.vm.currentTime);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  const headerViewportRef = useRef<HTMLDivElement | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);

  const totalWidth = (props.vm.maxTime - props.vm.minTime) * PIXELS_PER_UNIT;

  const scale = useMemo(() => {
    return createTimelineScale({
      minTime: props.vm.minTime,
      pixelsPerUnit: PIXELS_PER_UNIT,
    });
  }, [props.vm.minTime]);

  useEffect(() => {
    setCurrentTime(props.vm.currentTime);
  }, [props.vm.currentTime]);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const next = event.currentTarget.scrollLeft;
    setScrollLeft(next);

    // ヘッダの現在値と異なるときだけ代入し、不要な再レイアウトを避ける。
    if (headerViewportRef.current && headerViewportRef.current.scrollLeft !== next) {
      headerViewportRef.current.scrollLeft = next;
    }
  }, []);

  useEffect(() => {
    // プログラム側で scrollLeft を更新したときも body と同期させる。
    if (scrollViewportRef.current && scrollViewportRef.current.scrollLeft !== scrollLeft) {
      scrollViewportRef.current.scrollLeft = scrollLeft;
    }

    // ヘッダ側の初期値ズレを回避するため、state の値へ合わせる。
    if (headerViewportRef.current && headerViewportRef.current.scrollLeft !== scrollLeft) {
      headerViewportRef.current.scrollLeft = scrollLeft;
    }
  }, [scrollLeft]);

  return (
    <div className="timelinePanel" aria-label="timeline-board">
      <TimelineHeader
        ref={headerViewportRef}
        minTime={props.vm.minTime}
        maxTime={props.vm.maxTime}
        pixelsPerUnit={PIXELS_PER_UNIT}
        totalWidth={totalWidth}
      />

      <div className="timelineBodyRow">
        <TimelineLaneLabels lanes={props.vm.lanes} laneHeight={LANE_HEIGHT} />

        <TimelineScrollable
          ref={scrollViewportRef}
          vm={props.vm}
          totalWidth={totalWidth}
          laneHeight={LANE_HEIGHT}
          currentTime={currentTime}
          onCurrentTimeChange={setCurrentTime}
          onDraggingChange={setIsDraggingPlayhead}
          onScroll={handleScroll}
          timeToPx={scale.timeToPx}
          pxToTime={scale.pxToTime}
          isDraggingPlayhead={isDraggingPlayhead}
        />
      </div>
    </div>
  );
}
