import {
  forwardRef,
  useCallback,
  useRef,
  type UIEvent,
  type PointerEvent,
} from "react";
import type { ScenarioTimelineViewModel } from "../domain-types";
import { timelineStyles } from "../react-styles";
import { TimelineCursorOverlay } from "./TimelineCursorOverlay";
import { TimelineGrid } from "./TimelineGrid";
import { TimelineSegments } from "./TimelineSegments";

type TimelineScrollableProps = {
  vm: ScenarioTimelineViewModel;
  totalWidth: number;
  laneHeight: number;
  currentTime: number;
  isDraggingPlayhead: boolean;
  onCurrentTimeChange: (time: number) => void;
  onDraggingChange: (dragging: boolean) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  timeToPx: (time: number) => number;
  pxToTime: (px: number) => number;
};

/**
 * 右側スクロール領域でグリッド/セグメント/playhead と操作を管理する。
 * 入力例: `<TimelineScrollable vm={vm} totalWidth={1700} laneHeight={48} ... />`
 * 出力例: click seek と drag seek が可能なスクロール本体。
 */
export const TimelineScrollable = forwardRef<HTMLDivElement, TimelineScrollableProps>(
  function TimelineScrollable(props, ref) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const setViewportRef = useCallback(
      (node: HTMLDivElement | null) => {
        viewportRef.current = node;

        // 関数 ref が渡された場合は React 規約に沿って直接通知する。
        if (typeof ref === "function") {
          ref(node);
          return;
        }

        // object ref が渡された場合は current に代入して共有する。
        if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );

    const seekFromClientX = useCallback(
      (clientX: number) => {
        const rect = contentRef.current?.getBoundingClientRect();

        // content が未マウントなら座標基準を取得できないため処理を中断する。
        if (!rect) {
          return;
        }

        const x = clientX - rect.left;
        const clampedX = Math.max(0, Math.min(props.totalWidth, x));
        props.onCurrentTimeChange(props.pxToTime(clampedX));
      },
      [props.onCurrentTimeChange, props.pxToTime, props.totalWidth],
    );

    const onPointerDownBackground = useCallback(
      (event: PointerEvent<HTMLDivElement>) => {
        // 左クリック以外はスクロール操作などと競合しやすいため無視する。
        if (event.button !== 0) {
          return;
        }

        seekFromClientX(event.clientX);
      },
      [seekFromClientX],
    );

    const onPointerDownPlayhead = useCallback(
      (event: PointerEvent<HTMLElement>) => {
        // 左クリック以外はドラッグ開始しない。
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        props.onDraggingChange(true);

        const move = (nextEvent: globalThis.PointerEvent) => {
          seekFromClientX(nextEvent.clientX);
        };

        const up = () => {
          props.onDraggingChange(false);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      },
      [props.onDraggingChange, seekFromClientX],
    );

    return (
      <div
        className="timelineScrollViewport"
        style={timelineStyles.scrollViewport}
        ref={setViewportRef}
        onScroll={props.onScroll}
      >
        <div
          className="timelineScrollContent"
          style={{
            ...timelineStyles.scrollContent,
            width: props.totalWidth,
            height: props.vm.lanes.length * props.laneHeight,
          }}
          ref={contentRef}
          onPointerDown={onPointerDownBackground}
        >
          <TimelineGrid
            lanes={props.vm.lanes}
            laneHeight={props.laneHeight}
            minTime={props.vm.minTime}
            maxTime={props.vm.maxTime}
            timeToPx={props.timeToPx}
          />

          <TimelineSegments
            segments={props.vm.segments}
            markers={props.vm.markers}
            laneHeight={props.laneHeight}
            timeToPx={props.timeToPx}
            lanes={props.vm.lanes}
          />

          <TimelineCursorOverlay
            currentTime={props.currentTime}
            timeToPx={props.timeToPx}
            isDragging={props.isDraggingPlayhead}
            onPointerDown={onPointerDownPlayhead}
          />
        </div>
      </div>
    );
  },
);
