import type {
  ActionSpaceEntrypoint,
  ActionSpaceReport,
  AttackDslOperation,
  AttackDslReport,
  AttackDslScenario,
  TimelineFlow,
  TimelineBoard,
  TimelineClip,
  TimelineMarker,
} from "./domain-types";

const REQUEST_DURATION_MS = 380;
const REPLAY_DURATION_MS = 320;
const FLOW_LANE_ID = "lane-flow";

function hasKind(entrypoint: ActionSpaceEntrypoint, kind: string): boolean {
  return entrypoint.endpointKinds.includes(kind);
}

function normalizeRoutePrefix(routePath: string): string {
  return routePath.replace(/\/callback$/, "").replace(/\/_index$/, "");
}

function toOperationDurationMs(operation: AttackDslOperation): number {
  // request は短い実行区間として固定幅で可視化する。
  if (operation.type === "request") {
    return REQUEST_DURATION_MS;
  }

  // advance_time は絶対時間が長すぎるため、表示可能な幅に圧縮する。
  if (operation.type === "advance_time") {
    return Math.max(220, Math.min(900, Math.floor(operation.ms / 1000)));
  }

  // replay は request より短いイベントとして表示する。
  return REPLAY_DURATION_MS;
}

function toOperationCategory(operation: AttackDslOperation): "operation" {
  // operation 種別にかかわらず統合機能では同一カテゴリとして扱う。
  switch (operation.type) {
    case "request":
    case "advance_time":
    case "replay":
      return "operation";
  }
}

function toOperationLaneId(operation: AttackDslOperation): string {
  // request は Request レーンへ集約する。
  if (operation.type === "request") {
    return "lane-request";
  }

  // advance_time は時間制御専用レーンで分離して視認性を上げる。
  if (operation.type === "advance_time") {
    return "lane-advance";
  }

  // replay は再送操作なので replay レーンへ配置する。
  return "lane-replay";
}

function toOperationTone(operation: AttackDslOperation): "red" | "green" | "amber" {
  // advance_time は状態変化の中立操作として amber を使う。
  if (operation.type === "advance_time") {
    return "amber";
  }

  // replay シナリオは異常検証が主目的なので red を使う。
  if (operation.type === "replay") {
    return "red";
  }

  // 初回 request は基準操作として green を使う。
  return "green";
}

function toOperationLabel(operation: AttackDslOperation): string {
  // operation 種別で表示ラベルを分け、タイムライン上の意味を即読できるようにする。
  switch (operation.type) {
    case "request":
      return `request:${operation.id}`;
    case "advance_time":
      return `advance:${operation.ms}ms`;
    case "replay":
      return `replay:${operation.target}`;
  }
}

/**
 * ActionSpace から authorize + callback フロー候補を導出する。
 * 入力例: `deriveTimelineFlows(actionSpaceReport)`
 * 出力例: `[{ id: "flow-1", authorizePath: "/auth+/github+", callbackPath: "/auth+/github+/callback", ... }]`
 */
export function deriveTimelineFlows(actionSpace: ActionSpaceReport): TimelineFlow[] {
  const authorizeEntrypoints = actionSpace.entrypoints.filter((entrypoint) => {
    // authorize_start を持つ entrypoint だけを始点候補にする。
    return hasKind(entrypoint, "authorize_start") && Boolean(entrypoint.routePath);
  });
  const callbackEntrypoints = actionSpace.entrypoints.filter((entrypoint) => {
    // callback を持つ entrypoint だけを終点候補にする。
    return hasKind(entrypoint, "callback") && Boolean(entrypoint.routePath);
  });

  const flows: TimelineFlow[] = [];
  let flowIndex = 1;

  for (const authorize of authorizeEntrypoints) {
    for (const callback of callbackEntrypoints) {
      const authorizePath = authorize.routePath ?? "";
      const callbackPath = callback.routePath ?? "";

      // 同一 OAuth 系列の route prefix を共有する場合のみ 2ステップ探索候補として採用する。
      if (normalizeRoutePrefix(callbackPath) !== normalizeRoutePrefix(authorizePath)) {
        continue;
      }

      flows.push({
        id: `flow-${flowIndex}`,
        authorizeEntrypointId: authorize.id,
        callbackEntrypointId: callback.id,
        authorizePath,
        callbackPath,
      });
      flowIndex += 1;
    }
  }

  return flows;
}

/**
 * 攻撃シナリオIDからシナリオ本体を取得する。
 * 入力例: `findScenarioById(report, "entrypoint-1-replay")`
 * 出力例: `{ id: "entrypoint-1-replay", operations: [...] }`
 */
export function findScenarioById(
  report: AttackDslReport,
  scenarioId: string,
): AttackDslScenario {
  const found = report.scenarios.find((scenario) => scenario.id === scenarioId);

  // ID 不一致のまま進めると UI 側で undefined 参照になるため即時に失敗させる。
  if (!found) {
    throw new Error(`Scenario was not found: ${scenarioId}`);
  }

  return found;
}

/**
 * 統合レポート情報から、時間軸 UI 向けのボード構造を生成する。
 * 入力例: `buildTimelineBoard(scenario, flow)`
 * 出力例: `{ maxMs: 1600, lanes: [...], clips: [...], markers: [...] }`
 */
export function buildTimelineBoard(
  scenario: AttackDslScenario,
  flow?: TimelineFlow,
): TimelineBoard {
  const clips: TimelineClip[] = [];
  const markers: TimelineMarker[] = [];
  let cursorMs = 120;

  for (const operation of scenario.operations) {
    const durationMs = toOperationDurationMs(operation);
    const laneId = toOperationLaneId(operation);

    clips.push({
      id: `${scenario.id}-${operation.type}-${clips.length + 1}`,
      laneId,
      label: toOperationLabel(operation),
      startMs: cursorMs,
      endMs: cursorMs + durationMs,
      tone: toOperationTone(operation),
      category: toOperationCategory(operation),
    });

    // request と replay は境界点が重要なのでマーカーを追加して判読性を高める。
    if (operation.type === "request" || operation.type === "replay") {
      markers.push({
        id: `${scenario.id}-marker-${markers.length + 1}`,
        laneId,
        atMs: cursorMs + Math.floor(durationMs / 2),
      });
    }

    cursorMs += durationMs + 130;
  }

  clips.push({
    id: `${scenario.id}-policy-check`,
    laneId: "lane-policy",
    label: `expected:${scenario.expectedPolicyIds.join(",") || "none"}`,
    startMs: 80,
    endMs: Math.max(cursorMs, 520),
    tone: "red",
    category: "policy",
  });

  // フローが特定できるシナリオのみ authorize+callback の探索レーンを表示する。
  if (flow) {
    clips.push({
      id: `${scenario.id}-flow-match`,
      laneId: FLOW_LANE_ID,
      label: `${flow.authorizePath} -> ${flow.callbackPath}`,
      startMs: 90,
      endMs: Math.max(cursorMs, 640),
      tone: "green",
      category: "flow",
    });
  }

  return {
    maxMs: Math.max(cursorMs + 260, 1700),
    cursorMs: Math.min(554, cursorMs),
    lanes: [
      { id: "lane-request", label: "Request" },
      { id: "lane-advance", label: "Advance Time" },
      { id: "lane-replay", label: "Replay" },
      { id: "lane-policy", label: "Policy Check" },
      { id: FLOW_LANE_ID, label: "Authorize + Callback Flow" },
    ],
    clips,
    markers,
  };
}

/**
 * JSON 文字列を Attack DSL レポートとして厳格に読み込む。
 * 入力例: `parseAttackDslReportText('{"version":1,"generatedAt":"...","scenarios":[]}')`
 * 出力例: `{ version: 1, scenarios: [] }`
 */
export function parseAttackDslReportText(text: string): AttackDslReport {
  const data = JSON.parse(text) as Partial<AttackDslReport>;

  // version/scenarios が欠落した JSON はレポートとして扱えないため拒否する。
  if (data.version !== 1 || !Array.isArray(data.scenarios)) {
    throw new Error("Invalid attack-dsl report format.");
  }

  return {
    version: 1,
    generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : "",
    scenarios: data.scenarios,
  };
}

/**
 * JSON 文字列を ActionSpace レポートとして厳格に読み込む。
 * 入力例: `parseActionSpaceReportText('{"version":1,"generatedAt":"...","entrypoints":[]}')`
 * 出力例: `{ version: 1, entrypoints: [] }`
 */
export function parseActionSpaceReportText(text: string): ActionSpaceReport {
  const data = JSON.parse(text) as Partial<ActionSpaceReport>;

  // version/entrypoints が欠落した JSON はフロー導出に使えないため拒否する。
  if (data.version !== 1 || !Array.isArray(data.entrypoints)) {
    throw new Error("Invalid action-space report format.");
  }

  return {
    version: 1,
    generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : "",
    entrypoints: data.entrypoints,
  };
}
