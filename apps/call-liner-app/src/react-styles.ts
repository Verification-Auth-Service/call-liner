import type { CSSProperties } from "react";
import type { AttackDslOperation, TimelineSegmentTone } from "./domain-types";

const segmentToneMap: Record<TimelineSegmentTone, CSSProperties> = {
  request: { background: "#2f9d5c", color: "#effff2" },
  replay: { background: "#c94a4a", color: "#fff3f3" },
  state: { background: "#466177", color: "#eff8ff" },
  policy: { background: "#c5962c", color: "#fff7e8" },
  flow: { background: "#3f8f82", color: "#eefcf6" },
  advanceTime: { background: "#6f7d8f", color: "#f5f8fc" },
};

const operationBadgeMap: Record<AttackDslOperation["type"], CSSProperties> = {
  request: { background: "#225f3a" },
  replay: { background: "#7a2a2a" },
  advance_time: { background: "#455a73" },
};

export const appStyles = {
  root: {
    minHeight: "100vh",
    color: "#d6dbe3",
    background: "radial-gradient(circle at top right, #313843, #23262b 45%)",
    fontFamily: '"Segoe UI", "Noto Sans JP", sans-serif',
  } satisfies CSSProperties,
  header: {
    display: "flex",
    gap: "16px",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    background: "linear-gradient(90deg, #1d5aac, #2b74cc)",
  } satisfies CSSProperties,
  headerTitle: { margin: 0, fontSize: "24px" } satisfies CSSProperties,
  headerDescription: {
    margin: "4px 0 0",
    color: "#e4ebf8",
    fontSize: "13px",
  } satisfies CSSProperties,
  fileControls: { display: "flex", gap: "12px", flexWrap: "wrap" } satisfies CSSProperties,
  fileLabel: {
    display: "grid",
    gap: "4px",
    padding: "8px",
    borderRadius: "8px",
    background: "#2e333a",
    fontSize: "12px",
  } satisfies CSSProperties,
  errorBanner: {
    margin: 0,
    padding: "8px 16px",
    background: "#7d2828",
  } satisfies CSSProperties,
  workspaceGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(240px, 0.75fr) minmax(760px, 2.45fr) minmax(280px, 0.9fr)",
    gap: "8px",
    padding: "8px",
    height: "calc(100vh - 88px)",
  } satisfies CSSProperties,
  panel: {
    border: "1px solid #1c2025",
    background: "#2f343a",
    minHeight: 0,
  } satisfies CSSProperties,
  panelHeading: {
    margin: 0,
    padding: "10px 12px",
    borderBottom: "1px solid #1c2025",
    fontSize: "14px",
  } satisfies CSSProperties,
  scenariosPanel: { overflow: "auto" } satisfies CSSProperties,
  scenariosList: {
    listStyle: "none",
    margin: 0,
    padding: "8px",
    display: "grid",
    gap: "8px",
  } satisfies CSSProperties,
  scenarioButton: {
    width: "100%",
    textAlign: "left",
    border: "1px solid #4b5158",
    background: "#2c3136",
    color: "#d6dbe3",
    borderRadius: "6px",
    padding: "9px",
    cursor: "pointer",
  } satisfies CSSProperties,
  scenarioButtonActive: {
    borderColor: "#f0f3f7",
    background: "#3f4650",
  } satisfies CSSProperties,
  scenarioSmall: {
    display: "block",
    marginTop: "5px",
    color: "#9ea6b1",
  } satisfies CSSProperties,
  timelinePanelShell: {
    overflow: "hidden",
    minHeight: 0,
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.02)",
  } satisfies CSSProperties,
  inspectorPanel: {
    overflow: "auto",
  } satisfies CSSProperties,
  reportSummary: {
    display: "grid",
    gap: "4px",
    fontSize: "12px",
    color: "#9ea6b1",
    padding: "10px 12px",
  } satisfies CSSProperties,
  inspectorSection: {
    borderTop: "1px solid #222730",
  } satisfies CSSProperties,
  inspectorBlock: { margin: 0, padding: "10px 12px" } satisfies CSSProperties,
  scenarioTitle: { fontWeight: 600 } satisfies CSSProperties,
  operationList: {
    listStyle: "none",
    display: "grid",
    gap: "8px",
    margin: 0,
    padding: "10px 12px",
  } satisfies CSSProperties,
  findingList: {
    listStyle: "none",
    display: "grid",
    gap: "8px",
    margin: 0,
    padding: "10px 12px",
  } satisfies CSSProperties,
  listCard: {
    display: "grid",
    gap: "3px",
    padding: "8px",
    border: "1px solid #484f58",
    borderRadius: "6px",
    background: "#2b3036",
  } satisfies CSSProperties,
  operationBadge: {
    width: "fit-content",
    padding: "2px 7px",
    borderRadius: "999px",
    fontSize: "11px",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  helpSmall: { color: "#9ea6b1" } satisfies CSSProperties,
  policyTags: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    margin: 0,
    padding: "10px 12px",
  } satisfies CSSProperties,
  policyTag: {
    display: "inline-block",
    padding: "3px 8px",
    borderRadius: "999px",
    background: "#7f5f26",
    fontSize: "12px",
  } satisfies CSSProperties,
};

export const timelineStyles = {
  panel: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    background: "#2b333e",
    color: "#d7e3f4",
    borderLeft: "1px solid #20252d",
  } satisfies CSSProperties,
  headerRow: {
    display: "grid",
    gridTemplateColumns: "236px minmax(0, 1fr)",
    height: "44px",
    position: "sticky",
    top: 0,
    zIndex: 30,
    background: "#3a4552",
    borderBottom: "1px solid #20252d",
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.03)",
  } satisfies CSSProperties,
  headerCorner: {
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    fontSize: "13px",
    fontWeight: 600,
    color: "#dbe7fb",
    borderRight: "1px solid #242b36",
    background: "#3f4b58",
  } satisfies CSSProperties,
  headerViewport: {
    position: "relative",
    overflow: "hidden",
    background: "#37424e",
  } satisfies CSSProperties,
  headerContent: {
    position: "relative",
    height: "44px",
  } satisfies CSSProperties,
  headerTick: {
    position: "absolute",
    top: "7px",
    transform: "translateX(-50%)",
    fontSize: "13px",
    fontWeight: 600,
    color: "#d2deef",
    textShadow: "0 1px 0 rgba(0, 0, 0, 0.35)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  bodyRow: {
    display: "grid",
    gridTemplateColumns: "236px minmax(0, 1fr)",
    minHeight: 0,
    flex: 1,
  } satisfies CSSProperties,
  laneLabels: {
    position: "sticky",
    left: 0,
    zIndex: 10,
    background: "#353f4b",
    borderRight: "1px solid #202833",
    boxShadow: "inset -1px 0 0 rgba(255, 255, 255, 0.025)",
  } satisfies CSSProperties,
  scrollViewport: {
    position: "relative",
    overflowX: "auto",
    overflowY: "hidden",
    minWidth: 0,
    minHeight: 0,
    background: "#2d3642",
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.02)",
  } satisfies CSSProperties,
  scrollContent: {
    position: "relative",
    minHeight: "100%",
  } satisfies CSSProperties,
  gridLayer: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
  } satisfies CSSProperties,
  segmentsLayer: {
    position: "absolute",
    inset: 0,
  } satisfies CSSProperties,
  playhead: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "20px",
    transform: "translateX(-10px)",
    zIndex: 32,
    pointerEvents: "none",
  } satisfies CSSProperties,
};

/**
 * シナリオ選択ボタンの状態に応じたスタイルを返す。
 * 入力例: `getScenarioButtonStyle(true)`
 * 出力例: active 色を含む style オブジェクト。
 */
export function getScenarioButtonStyle(isActive: boolean): CSSProperties {
  // アクティブ行は選択中であることを即判別できる色へ切り替える。
  if (isActive) {
    return { ...appStyles.scenarioButton, ...appStyles.scenarioButtonActive };
  }

  return appStyles.scenarioButton;
}

/**
 * レーンラベル行のインデックスに応じた背景スタイルを返す。
 * 入力例: `getLaneLabelRowStyle(1, 48)`
 * 出力例: 偶数行と奇数行で弱い明度差を持つ style。
 */
export function getLaneLabelRowStyle(index: number, height: number): CSSProperties {
  return {
    height,
    display: "flex",
    alignItems: "center",
    padding: "0 14px",
    fontSize: "12px",
    letterSpacing: "0.02em",
    color: "#d7e3f7",
    borderBottom: "1px solid rgba(9, 14, 20, 0.6)",
    background: index % 2 === 0 ? "#34404c" : "#323d49",
  };
}

/**
 * グリッドのレーン行スタイルを返す。
 * 入力例: `getGridLaneRowStyle(0, 48, 2)`
 * 出力例: top と高さを含むトラック行 style。
 */
export function getGridLaneRowStyle(top: number, height: number, index: number): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    top,
    height,
    background: index % 2 === 0 ? "#2e3743" : "#2c3440",
    borderBottom: "1px solid rgba(8, 12, 18, 0.6)",
  };
}

/**
 * メジャー/マイナーの縦グリッド線スタイルを返す。
 * 入力例: `getGridLineStyle(true, 500)`
 * 出力例: 線色と left を含む style。
 */
export function getGridLineStyle(isMajor: boolean, left: number): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "1px",
    left,
    background: isMajor ? "rgba(166, 183, 209, 0.2)" : "rgba(164, 181, 207, 0.1)",
  };
}

/**
 * セグメントのトーンごとの帯スタイルを返す。
 * 入力例: `getSegmentStyle("request", 120, 9, 180, false)`
 * 出力例: フラットな timeline bar style。
 */
export function getSegmentStyle(
  tone: TimelineSegmentTone,
  left: number,
  top: number,
  width: number,
  isEvent: boolean,
): CSSProperties {
  return {
    position: "absolute",
    left,
    top,
    width,
    height: "34px",
    display: "flex",
    alignItems: "center",
    padding: "0 8px",
    borderRadius: "2px",
    border: isEvent
      ? "1px solid rgba(0, 0, 0, 0.22)"
      : "1px solid rgba(0, 0, 0, 0.18)",
    boxShadow: "none",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.01em",
    ...segmentToneMap[tone],
  };
}

/**
 * State レーン用チップのスタイルを返す。
 * 入力例: `getStateChipStyle(120, 8, 220)`
 * 出力例: 小さな pill 形状の state chip style。
 */
export function getStateChipStyle(left: number, top: number, width: number): CSSProperties {
  return {
    ...getSegmentStyle("state", left, top, width, false),
    height: "14px",
    padding: "0 6px",
    borderRadius: "999px",
    fontSize: "10px",
    lineHeight: 1,
    letterSpacing: "0.01em",
    border: "1px solid rgba(183, 214, 239, 0.28)",
    boxShadow: "0 1px 2px rgba(9, 15, 22, 0.3)",
  };
}

/**
 * マーカー表示位置のスタイルを返す。
 * 入力例: `getMarkerStyle(300, 96)`
 * 出力例: タイムライン帯に沿った縦ノッチ style。
 */
export function getMarkerStyle(left: number, top: number): CSSProperties {
  return {
    position: "absolute",
    width: "4px",
    height: "20px",
    left,
    top,
    marginLeft: "-2px",
    marginTop: "16px",
    background: "linear-gradient(180deg, #9eacbf, #7f8da1)",
    borderRadius: "2px",
    border: "1px solid rgba(0, 0, 0, 0.24)",
    transform: "none",
    zIndex: 24,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.34)",
  };
}

/**
 * playhead ラベルのドラッグ状態に応じたスタイルを返す。
 * 入力例: `getPlayheadLabelStyle(true)`
 * 出力例: 強調色を含むラベル style。
 */
export function getPlayheadLabelStyle(isDragging: boolean): CSSProperties {
  return {
    position: "absolute",
    top: "-2px",
    left: "50%",
    transform: "translate(-50%, -100%)",
    padding: "4px 9px",
    borderRadius: "999px",
    background: isDragging ? "linear-gradient(180deg, #e65b5b, #d94949)" : "linear-gradient(180deg, #d94a4a, #c83c3c)",
    color: "#ffffff",
    fontSize: "12px",
    fontWeight: 700,
    lineHeight: 1,
    pointerEvents: "auto",
    cursor: "ew-resize",
    boxShadow: "0 1px 0 rgba(255, 255, 255, 0.15), 0 2px 5px rgba(0, 0, 0, 0.38)",
  };
}

/**
 * playhead 線のドラッグ状態に応じたスタイルを返す。
 * 入力例: `getPlayheadLineStyle(false)`
 * 出力例: タイムライン縦線 style。
 */
export function getPlayheadLineStyle(isDragging: boolean): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "50%",
    width: "3px",
    transform: "translateX(-50%)",
    background: isDragging
      ? "linear-gradient(180deg, #ff7171, #ff5656)"
      : "linear-gradient(180deg, #ff5a5a, #e83f3f)",
    pointerEvents: "auto",
    cursor: "ew-resize",
    boxShadow: isDragging ? "0 0 0 1px rgba(255, 120, 120, 0.15), 0 0 8px rgba(255, 84, 84, 0.24)" : "none",
  };
}

/**
 * operation type に応じたバッジ背景色を返す。
 * 入力例: `getOperationBadgeStyle("replay")`
 * 出力例: replay 用の赤系背景を持つ style。
 */
export function getOperationBadgeStyle(type: AttackDslOperation["type"]): CSSProperties {
  return {
    ...appStyles.operationBadge,
    ...operationBadgeMap[type],
  };
}
