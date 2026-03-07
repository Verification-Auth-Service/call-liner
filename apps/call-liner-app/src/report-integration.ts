import type {
  ActionSpaceEntrypoint,
  ActionSpaceReport,
  AttackDslOperation,
  AttackDslReport,
  AttackDslScenario,
  ScenarioTimelineViewModel,
  TimelineBoard,
  TimelineClip,
  TimelineFlow,
  TimelineLaneKey,
  TimelineLaneViewModel,
  TimelineMarker,
  TimelineMarkerViewModel,
  TimelineSegmentTone,
  TimelineTickViewModel,
} from "./domain-types";

const REQUEST_DURATION_MS = 380;
const REPLAY_DURATION_MS = 320;
const TICK_STEP_MS = 100;
const MAJOR_TICK_STEP_MS = 500;
const CURSOR_START_MS = 120;
const SEGMENT_GAP_MS = 130;

const TIMELINE_LANES: TimelineLaneViewModel[] = [
  {
    key: "request",
    label: "Request",
    description: "初回リクエスト",
  },
  {
    key: "advanceTime",
    label: "Advance Time",
    description: "時間経過イベント",
  },
  {
    key: "replay",
    label: "Replay",
    description: "再送リクエスト",
  },
  {
    key: "policyCheck",
    label: "Policy Check",
    description: "期待ポリシー",
  },
  {
    key: "flow",
    label: "Authorize + Callback Flow",
    description: "entrypoint 遷移",
  },
];

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
    return Math.max(220, Math.min(980, Math.floor(operation.ms / 1000)));
  }

  // replay は request より短いイベントとして表示する。
  return REPLAY_DURATION_MS;
}

function toOperationLaneKey(operation: AttackDslOperation): TimelineLaneKey {
  // request は Request レーンへ集約する。
  if (operation.type === "request") {
    return "request";
  }

  // advance_time は時間制御専用レーンで分離して視認性を上げる。
  if (operation.type === "advance_time") {
    return "advanceTime";
  }

  // replay は再送操作なので replay レーンへ配置する。
  return "replay";
}

function toOperationTone(operation: AttackDslOperation): TimelineSegmentTone {
  // advance_time は時間経過を示す専用色を使う。
  if (operation.type === "advance_time") {
    return "advanceTime";
  }

  // replay は再送操作なので危険側の色を使う。
  if (operation.type === "replay") {
    return "replay";
  }

  // request は基準操作として成功系カラーを使う。
  return "request";
}

function toOperationLabel(operation: AttackDslOperation): string {
  // operation 種別で表示ラベルを分け、タイムライン上の意味を即読できるようにする。
  switch (operation.type) {
    case "request":
      return `request:${operation.id}`;
    case "advance_time":
      return `advance +${operation.ms}ms`;
    case "replay":
      return `replay:${operation.target}`;
  }
}

function toOperationDetail(operation: AttackDslOperation): string {
  // 種別ごとに有効なプロパティが異なるため表示文言を分ける。
  switch (operation.type) {
    case "request":
      return `${operation.request.method} ${operation.request.url}`;
    case "advance_time":
      return `Advance ${operation.ms}ms`;
    case "replay":
      return `Replay target: ${operation.target}`;
  }
}

function buildTimelineTicks(maxMs: number): TimelineTickViewModel[] {
  const ticks: TimelineTickViewModel[] = [];

  for (let timeMs = TICK_STEP_MS; timeMs <= maxMs; timeMs += TICK_STEP_MS) {
    ticks.push({
      timeMs,
      isMajor: timeMs % MAJOR_TICK_STEP_MS === 0,
    });
  }

  return ticks;
}

function toClipTone(tone: TimelineSegmentTone): "red" | "green" | "amber" {
  // request/flow は基準線として緑系に寄せる。
  if (tone === "request" || tone === "flow") {
    return "green";
  }

  // advance_time は中立イベントとして amber を使う。
  if (tone === "advanceTime") {
    return "amber";
  }

  // replay/policy は警告系として red を使う。
  return "red";
}

function toClipCategory(laneKey: TimelineLaneKey): "operation" | "policy" | "flow" {
  // policy レーンは policy カテゴリへ固定する。
  if (laneKey === "policyCheck") {
    return "policy";
  }

  // flow レーンは flow カテゴリへ固定する。
  if (laneKey === "flow") {
    return "flow";
  }

  // それ以外は操作カテゴリとして扱う。
  return "operation";
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
 * シナリオ JSON をタイムライン描画向け ViewModel に正規化する。
 * 入力例: `buildScenarioTimelineViewModel({ scenario, flow, inconclusive: [], missingOrSuspect: [] })`
 * 出力例: `{ lanes: [...], segments: [...], inspector: { operations: [...] } }`
 */
export function buildScenarioTimelineViewModel(params: {
  scenario: AttackDslScenario;
  flow?: TimelineFlow;
  inconclusive: AttackDslReport["inconclusive"];
  missingOrSuspect: AttackDslReport["missingOrSuspect"];
}): ScenarioTimelineViewModel {
  const { scenario, flow } = params;
  const inconclusive = params.inconclusive ?? [];
  const missingOrSuspect = params.missingOrSuspect ?? [];

  const segments: ScenarioTimelineViewModel["segments"] = [];
  const markers: TimelineMarkerViewModel[] = [];
  let cursorMs = CURSOR_START_MS;

  for (const operation of scenario.operations) {
    const durationMs = toOperationDurationMs(operation);
    const laneKey = toOperationLaneKey(operation);

    segments.push({
      id: `${scenario.id}-${operation.type}-${segments.length + 1}`,
      laneKey,
      startMs: cursorMs,
      durationMs,
      label: toOperationLabel(operation),
      tone: toOperationTone(operation),
      kind: operation.type === "advance_time" ? "event" : "bar",
    });

    // request/replay は操作開始点が重要なので先頭位置にマーカーを置く。
    if (operation.type === "request" || operation.type === "replay") {
      markers.push({
        id: `${scenario.id}-marker-${markers.length + 1}`,
        laneKey,
        atMs: cursorMs,
      });
    }

    // advance_time は時間経過の終端が重要なので終点にもマーカーを置く。
    if (operation.type === "advance_time") {
      markers.push({
        id: `${scenario.id}-marker-${markers.length + 1}`,
        laneKey,
        atMs: cursorMs + durationMs,
        label: `+${operation.ms}ms`,
      });
    }

    cursorMs += durationMs + SEGMENT_GAP_MS;
  }

  const coverageEndMs = Math.max(cursorMs, 520);

  segments.push({
    id: `${scenario.id}-policy-check`,
    laneKey: "policyCheck",
    startMs: 80,
    durationMs: coverageEndMs - 80,
    label: `expected:${scenario.expectedPolicyIds.join(",") || "none"}`,
    tone: "policy",
    kind: "bar",
  });

  // フローが特定できるシナリオのみ authorize+callback の探索レーンを表示する。
  if (flow) {
    segments.push({
      id: `${scenario.id}-flow-match`,
      laneKey: "flow",
      startMs: 90,
      durationMs: Math.max(cursorMs, 640) - 90,
      label: `${flow.authorizePath} -> ${flow.callbackPath}`,
      tone: "flow",
      kind: "bar",
    });
  }

  const maxMs = Math.max(cursorMs + 260, 1700);

  return {
    minTime: 0,
    maxTime: maxMs,
    currentTime: Math.min(554, cursorMs),
    ticks: buildTimelineTicks(maxMs),
    lanes: TIMELINE_LANES,
    segments,
    markers,
    inspector: {
      title: scenario.title,
      description: scenario.description,
      operations: scenario.operations.map((operation) => ({
        type: operation.type,
        detail: toOperationDetail(operation),
        note: operation.note,
      })),
      expectedPolicies: scenario.expectedPolicyIds,
      flowSummary: flow ? `${flow.authorizePath} -> ${flow.callbackPath}` : undefined,
      inconclusive,
      missingOrSuspect,
    },
  };
}

/**
 * 互換性のために旧 TimelineBoard 形式へ変換する。
 * 入力例: `buildTimelineBoard(scenario, flow)`
 * 出力例: `{ maxMs: 1700, lanes: [...], clips: [...], markers: [...] }`
 */
export function buildTimelineBoard(
  scenario: AttackDslScenario,
  flow?: TimelineFlow,
): TimelineBoard {
  const viewModel = buildScenarioTimelineViewModel({
    scenario,
    flow,
    inconclusive: [],
    missingOrSuspect: [],
  });

  const clips: TimelineClip[] = viewModel.segments.map((segment) => {
    return {
      id: segment.id,
      laneId: `lane-${segment.laneKey}`,
      label: segment.label,
      startMs: segment.startMs,
      endMs: segment.startMs + segment.durationMs,
      tone: toClipTone(segment.tone),
      category: toClipCategory(segment.laneKey),
    };
  });

  const markers: TimelineMarker[] = viewModel.markers.map((marker) => {
    return {
      id: marker.id,
      laneId: `lane-${marker.laneKey}`,
      atMs: marker.atMs,
    };
  });

  return {
    maxMs: viewModel.maxTime,
    cursorMs: viewModel.currentTime,
    lanes: viewModel.lanes.map((lane) => ({
      id: `lane-${lane.key}`,
      label: lane.label,
    })),
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
    summary:
      data.summary &&
      typeof data.summary.callbackEntrypoints === "number" &&
      typeof data.summary.scenarios === "number" &&
      typeof data.summary.generated === "number" &&
      typeof data.summary.inconclusive === "number" &&
      typeof data.summary.missingOrSuspect === "number"
        ? data.summary
        : {
            callbackEntrypoints: 0,
            scenarios: data.scenarios.length,
            generated: data.scenarios.length,
            inconclusive: Array.isArray(data.inconclusive)
              ? data.inconclusive.length
              : 0,
            missingOrSuspect: Array.isArray(data.missingOrSuspect)
              ? data.missingOrSuspect.length
              : 0,
          },
    generated: Array.isArray(data.generated) ? data.generated : data.scenarios,
    inconclusive: Array.isArray(data.inconclusive) ? data.inconclusive : [],
    missingOrSuspect: Array.isArray(data.missingOrSuspect)
      ? data.missingOrSuspect
      : [],
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
