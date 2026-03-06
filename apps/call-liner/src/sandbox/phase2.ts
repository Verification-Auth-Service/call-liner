import {
  runLoaderInPhase1Sandbox,
  type LoaderRequestInput,
  type RunLoaderInSandboxResult,
  type SandboxFetchStub,
  type SandboxLoader,
  type SandboxState,
} from "./phase1";

export type Phase2RequestOperation = {
  type: "request";
  id?: string;
  request: LoaderRequestInput;
  params?: Record<string, string>;
  context?: unknown;
  fetchStubs?: SandboxFetchStub[];
};

export type Phase2AdvanceTimeOperation = {
  type: "advance_time";
  ms?: number;
  atMs?: number;
};

export type Phase2ReplayOperation = {
  type: "replay";
  target: string | number;
};

export type Phase2SandboxOperation =
  | Phase2RequestOperation
  | Phase2AdvanceTimeOperation
  | Phase2ReplayOperation;

export type Phase2StepResult =
  | {
      type: "request";
      id?: string;
      response: Response;
    }
  | {
      type: "advance_time";
      fromMs: number;
      toMs: number;
    }
  | {
      type: "replay";
      target: string | number;
      response: Response;
    };

export type RunPhase2SandboxOptions = {
  loader: SandboxLoader;
  state: SandboxState;
  operations: Phase2SandboxOperation[];
};

export type RunPhase2SandboxResult = {
  nextState: SandboxState;
  steps: Phase2StepResult[];
};

type RecordedRequest = {
  id?: string;
  operationIndex: number;
  request: LoaderRequestInput;
  params?: Record<string, string>;
  context?: unknown;
  fetchStubs?: SandboxFetchStub[];
};

/**
 * Phase 2 の operation 列を順に実行し、時刻進行と replay を含む次状態を返す。
 *
 * 入力例:
 * - operations: [{ type: "request", id: "callback", request: { url: "https://app.test/callback?code=a" } }, { type: "advance_time", ms: 1000 }, { type: "replay", target: "callback" }]
 * 出力例:
 * - steps: [{ type: "request", ... }, { type: "advance_time", ... }, { type: "replay", ... }]
 * - nextState.trace に time_advanced / cookie_expired / replay が追記される
 */
export const runPhase2Sandbox = async (
  options: RunPhase2SandboxOptions,
): Promise<RunPhase2SandboxResult> => {
  let workingState = cloneState(options.state);
  const steps: Phase2StepResult[] = [];
  const recordedRequests: RecordedRequest[] = [];

  for (let index = 0; index < options.operations.length; index += 1) {
    const operation = options.operations[index];

    // operation 種別ごとに状態遷移が異なるため、分岐して専用処理を実行する。
    switch (operation.type) {
      case "request": {
        const result = await executeRequest(options.loader, workingState, operation);
        workingState = result.nextState;
        recordedRequests.push({
          id: operation.id,
          operationIndex: index,
          request: operation.request,
          params: operation.params,
          context: operation.context,
          fetchStubs: operation.fetchStubs,
        });
        steps.push({
          type: "request",
          id: operation.id,
          response: result.response.clone(),
        });
        break;
      }
      case "advance_time": {
        const advanced = applyAdvanceTime(workingState, operation);
        workingState = advanced.nextState;
        steps.push({
          type: "advance_time",
          fromMs: advanced.fromMs,
          toMs: advanced.toMs,
        });
        break;
      }
      case "replay": {
        const target = resolveReplayTarget(recordedRequests, operation.target);
        const replayResult = await executeRequest(options.loader, workingState, {
          type: "request",
          request: target.request,
          params: target.params,
          context: target.context,
          fetchStubs: target.fetchStubs,
        });
        replayResult.nextState.trace.push({
          type: "replay",
          target: operation.target,
          url: target.request.url,
          method: target.request.method ?? "GET",
        });
        workingState = replayResult.nextState;
        steps.push({
          type: "replay",
          target: operation.target,
          response: replayResult.response.clone(),
        });
        break;
      }
    }
  }

  return {
    nextState: workingState,
    steps,
  };
};

const executeRequest = async (
  loader: SandboxLoader,
  state: SandboxState,
  operation: Phase2RequestOperation,
): Promise<RunLoaderInSandboxResult> => {
  const stateWithoutExpiredCookies = removeExpiredCookies(state);

  return runLoaderInPhase1Sandbox({
    loader,
    state: stateWithoutExpiredCookies,
    request: operation.request,
    params: operation.params,
    context: operation.context,
    fetchStubs: operation.fetchStubs,
  });
};

const applyAdvanceTime = (
  state: SandboxState,
  operation: Phase2AdvanceTimeOperation,
): { nextState: SandboxState; fromMs: number; toMs: number } => {
  const fromMs = state.nowMs;
  const toMs = resolveNextTime(fromMs, operation);
  const nextState = cloneState(state);
  nextState.nowMs = toMs;
  nextState.trace.push({
    type: "time_advanced",
    fromMs,
    toMs,
  });

  return {
    nextState: removeExpiredCookies(nextState),
    fromMs,
    toMs,
  };
};

const resolveNextTime = (
  currentMs: number,
  operation: Phase2AdvanceTimeOperation,
): number => {
  // 相対指定と絶対指定が同時に与えられると意図が曖昧なので拒否する。
  if (operation.ms !== undefined && operation.atMs !== undefined) {
    throw new Error("advance_time requires either ms or atMs, but both were provided");
  }

  // 相対指定は現在時刻に加算する。
  if (operation.ms !== undefined) {
    return currentMs + operation.ms;
  }

  // 絶対指定はその時刻にジャンプする。
  if (operation.atMs !== undefined) {
    return operation.atMs;
  }

  throw new Error("advance_time requires ms or atMs");
};

const resolveReplayTarget = (
  recordedRequests: RecordedRequest[],
  target: string | number,
): RecordedRequest => {
  // 数値指定は operation index として探索する。
  if (typeof target === "number") {
    const foundByIndex = recordedRequests.find(
      (recorded) => recorded.operationIndex === target,
    );

    // 対象 index が存在しない場合は replay 元を確定できない。
    if (!foundByIndex) {
      throw new Error(`Replay target operation index was not found: ${target}`);
    }

    return foundByIndex;
  }

  const foundById = recordedRequests.find((recorded) => recorded.id === target);

  // 文字列指定は request.id に一致する履歴が必要。
  if (!foundById) {
    throw new Error(`Replay target request id was not found: ${target}`);
  }

  return foundById;
};

const removeExpiredCookies = (state: SandboxState): SandboxState => {
  const nextState = cloneState(state);

  for (const cookieName of Object.keys(nextState.cookieJar)) {
    const cookie = nextState.cookieJar[cookieName];

    // 期限なし cookie は削除判定の対象外とする。
    if (!cookie || cookie.expiresAtMs === null) {
      continue;
    }

    // 現在時刻に達した cookie は期限切れとして Jar から除去する。
    if (cookie.expiresAtMs <= nextState.nowMs) {
      delete nextState.cookieJar[cookieName];
      nextState.trace.push({
        type: "cookie_expired",
        name: cookie.name,
        expiredAtMs: cookie.expiresAtMs,
      });
    }
  }

  return nextState;
};

const cloneState = (state: SandboxState): SandboxState => {
  return {
    nowMs: state.nowMs,
    cookieJar: { ...state.cookieJar },
    trace: [...state.trace],
  };
};
