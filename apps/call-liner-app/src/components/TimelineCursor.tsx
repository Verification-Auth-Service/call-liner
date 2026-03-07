type TimelineCursorProps = {
  cursorMs: number;
  headerHeightPx: number;
  laneHeightPx: number;
  laneCount: number;
  labelColumnWidthPx: number;
  timeToPx: (timeMs: number) => number;
};

/**
 * 現在時刻カーソルをヘッダとグリッド上に重ねて描画する。
 * 入力例: `<TimelineCursor cursorMs={554} laneCount={5} ... />`
 * 出力例: 赤い縦線と現在時刻ラベルを持つオーバーレイ。
 */
export function TimelineCursor(props: TimelineCursorProps) {
  const { cursorMs, headerHeightPx, laneHeightPx, laneCount, labelColumnWidthPx, timeToPx } =
    props;
  const leftPx = labelColumnWidthPx + timeToPx(cursorMs);

  return (
    <div className="timeline-cursor-layer" aria-hidden>
      <span className="timeline-cursor-badge" style={{ left: leftPx }}>
        {cursorMs}
      </span>
      <span
        className="timeline-cursor-line"
        style={{
          left: leftPx,
          top: headerHeightPx,
          height: laneHeightPx * laneCount,
        }}
      />
    </div>
  );
}
