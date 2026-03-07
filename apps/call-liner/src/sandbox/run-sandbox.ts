import { pathToFileURL } from "node:url";
import { loadRouteLoaderFromFile } from "./load-route-loader-from-file";
import {
  buildDatabaseStrategyGlobals,
  type DatabaseStubStrategyName,
} from "./database-strategy";
import {
  createSandboxState,
  runLoaderInSandbox,
  type RunLoaderInSandboxResult,
  type SandboxLoader,
  type SandboxState,
} from "./runtime";
import {
  runSandbox,
  type SandboxOperation,
  type SandboxStepResult,
} from "./executor";
import {
  runOauthTwoStepSandbox,
  type OauthCallbackStateStrategy,
  type OauthTwoStepResult,
} from "./oauth-two-step";
import {
  applyEnvOverrides,
  buildDefaultFetchStubs,
  type DefaultFetchStubOverrides,
  createInMemorySession,
  parseKeyValue,
  requireNextValue,
  restoreEnvOverrides,
  toSetCookieHeader,
} from "./sandbox-cli-common";

type ParsedSingleCliArgs = {
  scenario: "single";
  loaderFile: string;
  url: string;
  method: string;
  requestId: string;
  sessionEntries: Array<[string, string]>;
  envEntries: Array<[string, string]>;
  fetchStubOverrides: DefaultFetchStubOverrides;
  databaseStrategyName: DatabaseStubStrategyName;
  databaseGlobalName: string;
  databaseModelNames: string[];
  advanceMsEntries: number[];
  replayTargets: Array<string | number>;
};

type ParsedOauthTwoStepCliArgs = {
  scenario: "oauth_two_step";
  authorizeLoaderFile: string;
  callbackLoaderFile: string;
  refreshLoaderFile?: string;
  authorizeUrl: string;
  callbackUrlBase: string;
  refreshUrl?: string;
  callbackCode?: string;
  callbackStateStrategy: OauthCallbackStateStrategy;
  callbackState?: string;
  enableStateFuzzing: boolean;
  enableGraphExplore: boolean;
  enableSpecValidation: boolean;
  stateExpiryMs: number;
  sessionEntries: Array<[string, string]>;
  envEntries: Array<[string, string]>;
  fetchStubOverrides: DefaultFetchStubOverrides;
  databaseStrategyName: DatabaseStubStrategyName;
  databaseGlobalName: string;
  databaseModelNames: string[];
};

type ParsedCliArgs = ParsedSingleCliArgs | ParsedOauthTwoStepCliArgs;

type OauthSerializedStep = {
  type: "authorize" | "callback" | "refresh";
  requestUrl: string;
  status: number;
  location: string | null;
  state: string | null;
  body: string;
};

type OauthSpecRuleId =
  | "missing_state_must_reject"
  | "state_mismatch_must_reject"
  | "replay_state_must_reject"
  | "double_callback_must_reject"
  | "callback_before_authorize_must_reject"
  | "callback_after_expiry_must_reject";

type OauthSpecViolation = {
  attackId: string;
  ruleId: OauthSpecRuleId;
  expected: string;
  actualStatus: number;
  stepType: "authorize" | "callback" | "refresh";
  vulnerability: true;
};

type OauthStateFuzzingAttackResult = {
  id:
    | "missing_state"
    | "replay_state"
    | "different_state"
    | "double_callback"
    | "callback_before_authorize"
    | "callback_after_expiry";
  title: string;
  steps: OauthSerializedStep[];
  violations: OauthSpecViolation[];
};

type OauthActionNode = "authorize" | "callback" | "refresh";

type OauthGraphPathResult = {
  order: OauthActionNode[];
  steps: OauthSerializedStep[];
  violations: OauthSpecViolation[];
};

/**
 * 統合サンドボックスを CLI から実行する。
 *
 * 入力例:
 * - ["--loader-file", "/tmp/callback.tsx", "--url", "https://app.test/auth/github/callback?code=a&state=b", "--advance-ms", "61000", "--replay", "callback"]
 * - ["--scenario", "oauth-two-step", "--authorize-loader-file", "/tmp/authorize.tsx", "--callback-loader-file", "/tmp/callback.tsx", "--authorize-url", "https://app.test/auth/github", "--callback-url-base", "https://app.test/auth/github/callback"]
 * 出力例:
 * - single: 標準出力に { steps, cookieJar, trace } を JSON 表示
 * - oauth-two-step: 標準出力に { steps, callbackRequest, cookieJar, trace } を JSON 表示
 */
export const runSandboxCli = async (rawArgs: string[]): Promise<void> => {
  const parsed = parseSandboxCliArgs(rawArgs);
  const originalEnvValues = applyEnvOverrides(
    parsed.scenario === "oauth_two_step"
      ? withDefaultOauthEnvEntries(parsed.envEntries)
      : parsed.envEntries,
  );

  try {
    const sessionRecord = new Map<string, unknown>(parsed.sessionEntries);

    // single モードは既存 executor ベースの timeline 実行を使う。
    if (parsed.scenario === "single") {
      const singleOutput = await runSingleScenario(parsed, sessionRecord);
      console.log(JSON.stringify(singleOutput, null, 2));
      return;
    }

    const oauthOutput = await runOauthTwoStepScenario(parsed, sessionRecord);
    console.log(JSON.stringify(oauthOutput, null, 2));
  } finally {
    restoreEnvOverrides(originalEnvValues);
  }
};

const parseSandboxCliArgs = (rawArgs: string[]): ParsedCliArgs => {
  let scenarioRaw: "single" | "oauth-two-step" | "" = "";

  let loaderFile = "";
  let url = "";
  let method = "GET";
  let requestId = "initial";
  const advanceMsEntries: number[] = [];
  const replayTargets: Array<string | number> = [];

  let authorizeLoaderFile = "";
  let callbackLoaderFile = "";
  let refreshLoaderFile: string | undefined;
  let authorizeUrl = "";
  let callbackUrlBase = "";
  let refreshUrl: string | undefined;
  let callbackCode: string | undefined;
  let callbackStateStrategy: OauthCallbackStateStrategy = "match_authorize";
  let callbackState: string | undefined;
  let enableStateFuzzing = false;
  let enableGraphExplore = false;
  let enableSpecValidation = false;
  let stateExpiryMs = 610_000;
  const fetchStubOverrides: DefaultFetchStubOverrides = {};
  let databaseStrategyName: DatabaseStubStrategyName = "none";
  let databaseGlobalName = "db";
  const databaseModelNames: string[] = [];

  const sessionEntries: Array<[string, string]> = [];
  const envEntries: Array<[string, string]> = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const nextValue = rawArgs[index + 1];

    // pnpm 経由実行では区切り文字 `--` が含まれるため読み飛ばす。
    if (arg === "--") {
      continue;
    }

    // シナリオを明示指定し、CLI パラメータの必須条件を切り替える。
    if (arg === "--scenario") {
      scenarioRaw = parseScenario(requireNextValue(arg, nextValue));
      index += 1;
      continue;
    }

    // `--loader-file` は single 実行対象 route module の必須パラメータ。
    if (arg === "--loader-file") {
      loaderFile = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // `--url` は single 実行の Request.url を作る必須パラメータ。
    if (arg === "--url") {
      url = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // method を明示したいケースに備えて任意指定を受け付ける。
    if (arg === "--method") {
      method = requireNextValue(arg, nextValue).toUpperCase();
      index += 1;
      continue;
    }

    // request の識別子を replay で参照するための id を受け付ける。
    if (arg === "--request-id") {
      requestId = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // 時刻進行は複数回指定を許容し、順番に適用する。
    if (arg === "--advance-ms") {
      const value = Number.parseInt(requireNextValue(arg, nextValue), 10);

      // 数値でない指定は期待挙動が不明なため拒否する。
      if (Number.isNaN(value)) {
        throw new Error(`Expected integer milliseconds for ${arg}`);
      }
      advanceMsEntries.push(value);
      index += 1;
      continue;
    }

    // replay は id 文字列か operation index 数値のどちらでも指定できる。
    if (arg === "--replay") {
      const replayRaw = requireNextValue(arg, nextValue);
      const replayIndex = Number.parseInt(replayRaw, 10);
      replayTargets.push(Number.isNaN(replayIndex) ? replayRaw : replayIndex);
      index += 1;
      continue;
    }

    // authorize の route module は oauth-two-step 1 ステップ目に必須。
    if (arg === "--authorize-loader-file") {
      authorizeLoaderFile = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // callback の route module は oauth-two-step 2 ステップ目に必須。
    if (arg === "--callback-loader-file") {
      callbackLoaderFile = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // refresh route module は graph exploration 用に任意で受け付ける。
    if (arg === "--refresh-loader-file") {
      refreshLoaderFile = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // authorize の Request.url を指定し、state 発行ロジックを通す。
    if (arg === "--authorize-url") {
      authorizeUrl = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // callback の URL ベースを指定し、query は実行時に合成する。
    if (arg === "--callback-url-base") {
      callbackUrlBase = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // refresh URL は refresh-loader-file と組み合わせて使用する。
    if (arg === "--refresh-url") {
      refreshUrl = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // callback code は再利用検証のため差し替え可能にする。
    if (arg === "--callback-code") {
      callbackCode = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // state の生成方針を切り替えて欠落/改ざんを探索する。
    if (arg === "--state-mode") {
      callbackStateStrategy = parseStateMode(requireNextValue(arg, nextValue));
      index += 1;
      continue;
    }

    // fixed/tampered で明示値を使いたいときに state を上書きする。
    if (arg === "--callback-state") {
      callbackState = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // state fuzzing は攻撃ケースを自動生成して順に実行する。
    if (arg === "--state-fuzzing") {
      enableStateFuzzing = true;
      continue;
    }

    // graph explore は action 順序の順列をすべて実行する。
    if (arg === "--graph-explore") {
      enableGraphExplore = true;
      continue;
    }

    // spec validate は OAuth 仕様ルール違反を vulnerability として出力する。
    if (arg === "--spec-validate") {
      enableSpecValidation = true;
      continue;
    }

    // callback after expiry 用に state の有効期限経過時間を調整できるようにする。
    if (arg === "--state-expiry-ms") {
      const value = Number.parseInt(requireNextValue(arg, nextValue), 10);

      // 数値でない指定は時刻計算ができないため拒否する。
      if (Number.isNaN(value)) {
        throw new Error(`Expected integer milliseconds for ${arg}`);
      }
      stateExpiryMs = value;
      index += 1;
      continue;
    }

    // `--session key=value` は getSession 初期値を与える。
    if (arg === "--session") {
      const entry = parseKeyValue(requireNextValue(arg, nextValue), arg);
      sessionEntries.push(entry);
      index += 1;
      continue;
    }

    // `--env key=value` は route 実行中の process.env を一時的に上書きする。
    if (arg === "--env") {
      const entry = parseKeyValue(requireNextValue(arg, nextValue), arg);
      envEntries.push(entry);
      index += 1;
      continue;
    }

    // DB 依存の注入方式を strategy で切り替える。
    if (arg === "--database-strategy") {
      databaseStrategyName = parseDatabaseStrategy(
        requireNextValue(arg, nextValue),
      );
      index += 1;
      continue;
    }

    // ルート内で参照される DB クライアント変数名を指定する。
    if (arg === "--database-global") {
      databaseGlobalName = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // model delegate 名を複数指定して、必要なテーブル参照だけ注入する。
    if (arg === "--database-model") {
      databaseModelNames.push(requireNextValue(arg, nextValue));
      index += 1;
      continue;
    }

    // OAuth token スタブへ refresh_token を含めたい場合に上書きする。
    if (arg === "--stub-refresh-token") {
      fetchStubOverrides.githubRefreshToken = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  // none 戦略で DB 用オプションが渡ると期待が曖昧なため拒否する。
  if (
    databaseStrategyName === "none" &&
    (databaseGlobalName !== "db" || databaseModelNames.length > 0)
  ) {
    throw new Error(
      "--database-global and --database-model require --database-strategy memory-client.",
    );
  }

  const hasOauthSpecificArgs =
    authorizeLoaderFile.length > 0 ||
    callbackLoaderFile.length > 0 ||
    refreshLoaderFile !== undefined ||
    authorizeUrl.length > 0 ||
    callbackUrlBase.length > 0 ||
    refreshUrl !== undefined ||
    callbackCode !== undefined ||
    callbackState !== undefined ||
    callbackStateStrategy !== "match_authorize" ||
    enableStateFuzzing ||
    enableGraphExplore ||
    enableSpecValidation ||
    stateExpiryMs !== 610_000;
  const scenario = scenarioRaw
    ? toInternalScenarioName(scenarioRaw)
    : hasOauthSpecificArgs
      ? "oauth_two_step"
      : "single";

  // oauth オプションを指定しない通常実行は single として扱う。
  if (scenario === "single") {
    // single シナリオに oauth 専用オプションが混ざると意図が曖昧なので拒否する。
    if (hasOauthSpecificArgs) {
      throw new Error(
        "OAuth two-step options are not allowed in single scenario. Use --scenario oauth-two-step.",
      );
    }

    // loader ファイル未指定では実行対象が定まらないため失敗させる。
    if (!loaderFile) {
      throw new Error("Missing required argument: --loader-file <path>");
    }

    // URL 未指定では Request が作れないため失敗させる。
    if (!url) {
      throw new Error("Missing required argument: --url <request-url>");
    }

    return {
      scenario: "single",
      loaderFile,
      url,
      method,
      requestId,
      sessionEntries,
      envEntries,
      fetchStubOverrides,
      databaseStrategyName,
      databaseGlobalName,
      databaseModelNames,
      advanceMsEntries,
      replayTargets,
    };
  }

  // oauth-two-step では single 専用オプションを許可しない。
  if (loaderFile || url || method !== "GET" || requestId !== "initial") {
    throw new Error(
      "Single scenario options are not allowed in oauth-two-step scenario.",
    );
  }

  // oauth-two-step では timeline 操作をサポートしない。
  if (advanceMsEntries.length > 0 || replayTargets.length > 0) {
    throw new Error(
      "--advance-ms and --replay are not supported in oauth-two-step scenario.",
    );
  }

  // authorize loader 未指定では 1 ステップ目が実行できない。
  if (!authorizeLoaderFile) {
    throw new Error("Missing required argument: --authorize-loader-file <path>");
  }

  // callback loader 未指定では 2 ステップ目が実行できない。
  if (!callbackLoaderFile) {
    throw new Error("Missing required argument: --callback-loader-file <path>");
  }

  // refresh loader がある場合は refresh URL も必須にして request を一意化する。
  if (refreshLoaderFile && !refreshUrl) {
    throw new Error(
      "Missing required argument: --refresh-url <request-url> when --refresh-loader-file is used",
    );
  }

  // authorize URL 未指定では Request が構築できない。
  if (!authorizeUrl) {
    throw new Error("Missing required argument: --authorize-url <request-url>");
  }

  // callback URL 未指定では 2 ステップ目の遷移先が定まらない。
  if (!callbackUrlBase) {
    throw new Error("Missing required argument: --callback-url-base <request-url>");
  }

  return {
    scenario: "oauth_two_step",
    authorizeLoaderFile,
    callbackLoaderFile,
    refreshLoaderFile,
    authorizeUrl,
    callbackUrlBase,
    refreshUrl,
    callbackCode,
    callbackStateStrategy,
    callbackState,
    enableStateFuzzing,
    enableGraphExplore,
    enableSpecValidation,
    stateExpiryMs,
    sessionEntries,
    envEntries,
    fetchStubOverrides,
    databaseStrategyName,
    databaseGlobalName,
    databaseModelNames,
  };
};

const parseScenario = (raw: string): "single" | "oauth-two-step" => {
  // シナリオ指定は既知値のみ許可し、CLI 解釈を安定させる。
  if (raw === "single" || raw === "oauth-two-step") {
    return raw;
  }

  throw new Error(`Unknown scenario: ${raw}. Expected one of single, oauth-two-step`);
};

const toInternalScenarioName = (
  scenario: "single" | "oauth-two-step",
): "single" | "oauth_two_step" => {
  // 外向き CLI 名と内部識別子の差分をここで吸収する。
  if (scenario === "oauth-two-step") {
    return "oauth_two_step";
  }

  return "single";
};

const parseStateMode = (raw: string): OauthCallbackStateStrategy => {
  // 指定値は既知モードのみ許可し、探索結果の解釈を安定させる。
  if (
    raw === "match_authorize" ||
    raw === "tampered" ||
    raw === "missing" ||
    raw === "fixed"
  ) {
    return raw;
  }

  throw new Error(
    `Unknown state mode: ${raw}. Expected one of match_authorize, tampered, missing, fixed`,
  );
};

const parseDatabaseStrategy = (raw: string): DatabaseStubStrategyName => {
  // strategy 指定は既知値のみ許可し、注入挙動を一意にする。
  if (raw === "none" || raw === "memory-client") {
    return raw;
  }

  throw new Error(
    `Unknown database strategy: ${raw}. Expected one of none, memory-client`,
  );
};

const runSingleScenario = async (
  parsed: ParsedSingleCliArgs,
  sessionRecord: Map<string, unknown>,
): Promise<{
  steps: Array<
    | { type: "request"; id?: string; status: number; location: string | null; body: string }
    | { type: "advance_time"; fromMs: number; toMs: number }
    | { type: "replay"; target: string | number; status: number; location: string | null; body: string }
  >;
  cookieJar: ReturnType<typeof createSandboxState>["cookieJar"];
  trace: ReturnType<typeof createSandboxState>["trace"];
}> => {
  const state = createSandboxState();
  const loader = await loadRouteLoaderFromFile(parsed.loaderFile, {
    redirect: (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Location", url);
      return new Response(null, { ...init, status: init?.status ?? 302, headers });
    },
    getSession: async () => createInMemorySession(sessionRecord),
    commitSession: async (session, options) =>
      toSetCookieHeader(sessionRecord, session, options?.maxAge),
    globals: buildDatabaseStrategyGlobals({
      strategyName: parsed.databaseStrategyName,
      globalName: parsed.databaseGlobalName,
      modelNames: parsed.databaseModelNames,
    }),
  });

  const operations = buildSandboxOperations(parsed);
  const result = await runSandbox({
    loader,
    state,
    operations,
  });

  return {
    steps: await serializeStepResults(result.steps),
    cookieJar: result.nextState.cookieJar,
    trace: result.nextState.trace,
  };
};

const runOauthTwoStepScenario = async (
  parsed: ParsedOauthTwoStepCliArgs,
  sessionRecord: Map<string, unknown>,
): Promise<{
  steps: OauthSerializedStep[];
  callbackRequest: {
    url: string;
    method?: string;
    headers?: Headers | Array<[string, string]> | Record<string, string> | undefined;
    body?: RequestInit["body"];
  };
  fuzzing?: {
    attacks: OauthStateFuzzingAttackResult[];
    vulnerabilities: OauthSpecViolation[];
  };
  graphExploration?: {
    paths: OauthGraphPathResult[];
    vulnerabilities: OauthSpecViolation[];
  };
  cookieJar: ReturnType<typeof createSandboxState>["cookieJar"];
  trace: ReturnType<typeof createSandboxState>["trace"];
}> => {
  const createRuntimeDeps = (record: Map<string, unknown>) => ({
    redirect: (url: string, init?: ResponseInit) => {
      const headers = new Headers(init?.headers);
      headers.set("Location", url);
      return new Response(null, { ...init, status: init?.status ?? 302, headers });
    },
    getSession: async () => createInMemorySession(record),
    commitSession: async (session: { get: (key: string) => unknown; set: (key: string, value: unknown) => void }, options?: { maxAge?: number }) =>
      toSetCookieHeader(record, session, options?.maxAge),
    globals: {
      ...buildDefaultSandboxGlobals(),
      ...buildDatabaseStrategyGlobals({
        strategyName: parsed.databaseStrategyName,
        globalName: parsed.databaseGlobalName,
        modelNames: parsed.databaseModelNames,
      }),
    },
  });
  const state = createSandboxState();
  const runtimeDeps = createRuntimeDeps(sessionRecord);
  const authorizeLoader = await loadRouteLoaderFromFile(
    parsed.authorizeLoaderFile,
    runtimeDeps,
  );
  const callbackLoader = await loadRouteLoaderFromFile(
    parsed.callbackLoaderFile,
    runtimeDeps,
  );
  const refreshLoader = parsed.refreshLoaderFile
    ? await loadRouteLoaderFromFile(parsed.refreshLoaderFile, runtimeDeps)
    : undefined;
  const fetchStubs = buildDefaultFetchStubs(parsed.fetchStubOverrides);

  const result = await runOauthTwoStepSandbox({
    authorizeLoader,
    callbackLoader,
    state,
    authorizeRequest: {
      url: parsed.authorizeUrl,
      method: "GET",
    },
    callbackUrlBase: parsed.callbackUrlBase,
    callbackCode: parsed.callbackCode,
    callbackStateStrategy: parsed.callbackStateStrategy,
    fixedCallbackState: parsed.callbackState,
    authorizeFetchStubs: fetchStubs,
    callbackFetchStubs: fetchStubs,
  });
  const fuzzing = parsed.enableStateFuzzing
    ? await runOauthStateFuzzing({
        parsed,
        authorizeLoader,
        callbackLoader,
        createRuntimeDeps,
      })
    : undefined;
  const graphExploration = parsed.enableGraphExplore
    ? await runOauthGraphExplore({
        parsed,
        authorizeLoader,
        callbackLoader,
        refreshLoader,
        fetchStubs,
      })
    : undefined;

  return {
    steps: await serializeOauthStepResults(result.steps),
    callbackRequest: result.callbackRequest,
    fuzzing,
    graphExploration,
    cookieJar: result.nextState.cookieJar,
    trace: result.nextState.trace,
  };
};

const runOauthStateFuzzing = async (input: {
  parsed: ParsedOauthTwoStepCliArgs;
  authorizeLoader: SandboxLoader;
  callbackLoader: SandboxLoader;
  createRuntimeDeps: (record: Map<string, unknown>) => {
    redirect: (url: string, init?: ResponseInit) => Response;
    getSession: () => Promise<ReturnType<typeof createInMemorySession>>;
    commitSession: (
      session: { get: (key: string) => unknown; set: (key: string, value: unknown) => void },
      options?: { maxAge?: number },
    ) => Promise<string>;
    globals: Record<string, unknown>;
  };
}): Promise<{
  attacks: OauthStateFuzzingAttackResult[];
  vulnerabilities: OauthSpecViolation[];
}> => {
  const attacks: OauthStateFuzzingAttackResult[] = [];
  const defaultCode = input.parsed.callbackCode ?? "sandbox-code";

  attacks.push(
    await runMissingStateAttack({
      parsed: input.parsed,
      authorizeLoader: input.authorizeLoader,
      callbackLoader: input.callbackLoader,
      defaultCode,
    }),
  );
  attacks.push(
    await runReplayStateAttack({
      parsed: input.parsed,
      authorizeLoader: input.authorizeLoader,
      callbackLoader: input.callbackLoader,
      defaultCode,
    }),
  );
  attacks.push(
    await runDifferentStateAttack({
      parsed: input.parsed,
      authorizeLoader: input.authorizeLoader,
      callbackLoader: input.callbackLoader,
      defaultCode,
    }),
  );
  attacks.push(
    await runDoubleCallbackAttack({
      parsed: input.parsed,
      authorizeLoader: input.authorizeLoader,
      callbackLoader: input.callbackLoader,
      defaultCode,
    }),
  );
  attacks.push(
    await runCallbackBeforeAuthorizeAttack({
      parsed: input.parsed,
      callbackLoader: input.callbackLoader,
      defaultCode,
    }),
  );
  attacks.push(
    await runCallbackAfterExpiryAttack({
      parsed: input.parsed,
      authorizeLoader: input.authorizeLoader,
      callbackLoader: input.callbackLoader,
      defaultCode,
      createRuntimeDeps: input.createRuntimeDeps,
    }),
  );

  return {
    attacks,
    vulnerabilities: attacks.flatMap((attack) => attack.violations),
  };
};

const runMissingStateAttack = async (input: {
  parsed: ParsedOauthTwoStepCliArgs;
  authorizeLoader: SandboxLoader;
  callbackLoader: SandboxLoader;
  defaultCode: string;
}): Promise<OauthStateFuzzingAttackResult> => {
  const baseState = createSandboxState();
  const runResult = await runOauthTwoStepSandbox({
    authorizeLoader: input.authorizeLoader,
    callbackLoader: input.callbackLoader,
    state: baseState,
    authorizeRequest: {
      url: input.parsed.authorizeUrl,
      method: "GET",
    },
    callbackUrlBase: input.parsed.callbackUrlBase,
    callbackCode: input.defaultCode,
    callbackStateStrategy: "missing",
    authorizeFetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
    callbackFetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
  });
  const steps = await serializeOauthStepResults(runResult.steps);
  const callbackStep = steps.find((step) => step.type === "callback");

  return {
    id: "missing_state",
    title: "missing state",
    steps,
    violations: validateOauthSpec(
      "missing_state",
      callbackStep ? [toSpecCheck("missing_state_must_reject", callbackStep)] : [],
      input.parsed.enableSpecValidation,
    ),
  };
};

const runReplayStateAttack = async (input: {
  parsed: ParsedOauthTwoStepCliArgs;
  authorizeLoader: SandboxLoader;
  callbackLoader: SandboxLoader;
  defaultCode: string;
}): Promise<OauthStateFuzzingAttackResult> => {
  const baseState = createSandboxState();
  const runResult = await runOauthTwoStepSandbox({
    authorizeLoader: input.authorizeLoader,
    callbackLoader: input.callbackLoader,
    state: baseState,
    authorizeRequest: {
      url: input.parsed.authorizeUrl,
      method: "GET",
    },
    callbackUrlBase: input.parsed.callbackUrlBase,
    callbackCode: input.defaultCode,
    callbackStateStrategy: "match_authorize",
    authorizeFetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
    callbackFetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
  });
  let state = runResult.nextState;
  const replay = await runLoaderInSandbox({
    loader: input.callbackLoader,
    state,
    request: runResult.callbackRequest,
    fetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
  });
  state = replay.nextState;
  const steps = await serializeOauthMixedStepResults([
    ...runResult.steps,
    toManualStepResult("callback", runResult.callbackRequest.url, replay),
  ]);
  const callbackSteps = steps.filter((step) => step.type === "callback");
  const replayStep = callbackSteps[1];

  return {
    id: "replay_state",
    title: "replay state",
    steps,
    violations: validateOauthSpec(
      "replay_state",
      replayStep ? [toSpecCheck("replay_state_must_reject", replayStep)] : [],
      input.parsed.enableSpecValidation,
    ),
  };
};

const runDifferentStateAttack = async (input: {
  parsed: ParsedOauthTwoStepCliArgs;
  authorizeLoader: SandboxLoader;
  callbackLoader: SandboxLoader;
  defaultCode: string;
}): Promise<OauthStateFuzzingAttackResult> => {
  const baseState = createSandboxState();
  const runResult = await runOauthTwoStepSandbox({
    authorizeLoader: input.authorizeLoader,
    callbackLoader: input.callbackLoader,
    state: baseState,
    authorizeRequest: {
      url: input.parsed.authorizeUrl,
      method: "GET",
    },
    callbackUrlBase: input.parsed.callbackUrlBase,
    callbackCode: input.defaultCode,
    callbackStateStrategy: "tampered",
    authorizeFetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
    callbackFetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
  });
  const steps = await serializeOauthStepResults(runResult.steps);
  const callbackStep = steps.find((step) => step.type === "callback");

  return {
    id: "different_state",
    title: "different state",
    steps,
    violations: validateOauthSpec(
      "different_state",
      callbackStep ? [toSpecCheck("state_mismatch_must_reject", callbackStep)] : [],
      input.parsed.enableSpecValidation,
    ),
  };
};

const runDoubleCallbackAttack = async (input: {
  parsed: ParsedOauthTwoStepCliArgs;
  authorizeLoader: SandboxLoader;
  callbackLoader: SandboxLoader;
  defaultCode: string;
}): Promise<OauthStateFuzzingAttackResult> => {
  const baseState = createSandboxState();
  const runResult = await runOauthTwoStepSandbox({
    authorizeLoader: input.authorizeLoader,
    callbackLoader: input.callbackLoader,
    state: baseState,
    authorizeRequest: {
      url: input.parsed.authorizeUrl,
      method: "GET",
    },
    callbackUrlBase: input.parsed.callbackUrlBase,
    callbackCode: input.defaultCode,
    callbackStateStrategy: "match_authorize",
    authorizeFetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
    callbackFetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
  });
  const firstCallback = runResult.steps[1];

  // callback が想定外に取得できない場合は追撃 request を構築できないため失敗させる。
  if (!firstCallback) {
    throw new Error("double callback attack requires callback step");
  }

  const firstState = firstCallback.state ?? "sandbox-state";
  const secondRequest = buildManualCallbackRequest(
    input.parsed.callbackUrlBase,
    `${input.defaultCode}-second`,
    firstState,
  );
  const secondCallback = await runLoaderInSandbox({
    loader: input.callbackLoader,
    state: runResult.nextState,
    request: secondRequest,
    fetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
  });
  const steps = await serializeOauthMixedStepResults([
    ...runResult.steps,
    toManualStepResult("callback", secondRequest.url, secondCallback),
  ]);
  const callbackSteps = steps.filter((step) => step.type === "callback");
  const secondStep = callbackSteps[1];

  return {
    id: "double_callback",
    title: "double callback",
    steps,
    violations: validateOauthSpec(
      "double_callback",
      secondStep ? [toSpecCheck("double_callback_must_reject", secondStep)] : [],
      input.parsed.enableSpecValidation,
    ),
  };
};

const runCallbackBeforeAuthorizeAttack = async (input: {
  parsed: ParsedOauthTwoStepCliArgs;
  callbackLoader: SandboxLoader;
  defaultCode: string;
}): Promise<OauthStateFuzzingAttackResult> => {
  const baseState = createSandboxState();
  const callbackRequest = buildManualCallbackRequest(
    input.parsed.callbackUrlBase,
    input.defaultCode,
    "state-before-authorize",
  );
  const callback = await runLoaderInSandbox({
    loader: input.callbackLoader,
    state: baseState,
    request: callbackRequest,
    fetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
  });
  const steps = await serializeOauthMixedStepResults([
    toManualStepResult("callback", callbackRequest.url, callback),
  ]);
  const callbackStep = steps[0];

  return {
    id: "callback_before_authorize",
    title: "callback before authorize",
    steps,
    violations: validateOauthSpec(
      "callback_before_authorize",
      callbackStep
        ? [toSpecCheck("callback_before_authorize_must_reject", callbackStep)]
        : [],
      input.parsed.enableSpecValidation,
    ),
  };
};

const runCallbackAfterExpiryAttack = async (input: {
  parsed: ParsedOauthTwoStepCliArgs;
  authorizeLoader: SandboxLoader;
  callbackLoader: SandboxLoader;
  defaultCode: string;
  createRuntimeDeps: (record: Map<string, unknown>) => {
    redirect: (url: string, init?: ResponseInit) => Response;
    getSession: () => Promise<ReturnType<typeof createInMemorySession>>;
    commitSession: (
      session: { get: (key: string) => unknown; set: (key: string, value: unknown) => void },
      options?: { maxAge?: number },
    ) => Promise<string>;
    globals: Record<string, unknown>;
  };
}): Promise<OauthStateFuzzingAttackResult> => {
  const sessionRecord = new Map<string, unknown>(input.parsed.sessionEntries);
  const runtimeDeps = input.createRuntimeDeps(sessionRecord);
  const authorizeLoader = await loadRouteLoaderFromFile(
    input.parsed.authorizeLoaderFile,
    runtimeDeps,
  );
  const callbackLoader = await loadRouteLoaderFromFile(
    input.parsed.callbackLoaderFile,
    runtimeDeps,
  );
  const authorize = await runLoaderInSandbox({
    loader: authorizeLoader,
    state: createSandboxState(),
    request: {
      url: input.parsed.authorizeUrl,
      method: "GET",
    },
    fetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
  });
  const authorizeLocation = authorize.response.headers.get("Location");
  const authorizeState = authorizeLocation
    ? new URL(authorizeLocation, "https://sandbox.local").searchParams.get("state")
    : "sandbox-state";

  // session 期限切れを擬似再現するため、expiry 時点で oauth state を破棄する。
  sessionRecord.delete("oauth:state");
  const callbackRequest = buildManualCallbackRequest(
    input.parsed.callbackUrlBase,
    input.defaultCode,
    authorizeState,
  );
  const callback = await runLoaderInSandbox({
    loader: callbackLoader,
    state: {
      ...authorize.nextState,
      nowMs: authorize.nextState.nowMs + input.parsed.stateExpiryMs,
    },
    request: callbackRequest,
    fetchStubs: buildDefaultFetchStubs(input.parsed.fetchStubOverrides),
  });
  const steps = await serializeOauthMixedStepResults([
    toManualStepResult("authorize", input.parsed.authorizeUrl, authorize),
    toManualStepResult("callback", callbackRequest.url, callback),
  ]);
  const callbackStep = steps.find((step) => step.type === "callback");

  return {
    id: "callback_after_expiry",
    title: "callback after expiry",
    steps,
    violations: validateOauthSpec(
      "callback_after_expiry",
      callbackStep ? [toSpecCheck("callback_after_expiry_must_reject", callbackStep)] : [],
      input.parsed.enableSpecValidation,
    ),
  };
};

const runOauthGraphExplore = async (input: {
  parsed: ParsedOauthTwoStepCliArgs;
  authorizeLoader: SandboxLoader;
  callbackLoader: SandboxLoader;
  refreshLoader?: SandboxLoader;
  fetchStubs: ReturnType<typeof buildDefaultFetchStubs>;
}): Promise<{
  paths: OauthGraphPathResult[];
  vulnerabilities: OauthSpecViolation[];
}> => {
  const actions: OauthActionNode[] = ["authorize", "callback"];

  // refresh loader があるケースだけ 3 ノード順列探索を有効化する。
  if (input.refreshLoader) {
    actions.push("refresh");
  }
  const orders = permutations(actions);
  const paths: OauthGraphPathResult[] = [];

  for (const order of orders) {
    let state = createSandboxState();
    const steps: Array<OauthTwoStepResult | OauthSerializedStep> = [];
    let authorizeState: string | null = null;
    let seenAuthorize = false;

    for (const action of order) {
      // action 種別ごとに request の作り方が異なるため、分岐して実行する。
      if (action === "authorize") {
        const authorize = await runLoaderInSandbox({
          loader: input.authorizeLoader,
          state,
          request: {
            url: input.parsed.authorizeUrl,
            method: "GET",
          },
          fetchStubs: input.fetchStubs,
        });
        state = authorize.nextState;
        const location = authorize.response.headers.get("Location");
        authorizeState = location
          ? new URL(location, "https://sandbox.local").searchParams.get("state")
          : null;
        seenAuthorize = true;
        steps.push(toManualStepResult("authorize", input.parsed.authorizeUrl, authorize));
        continue;
      }

      if (action === "callback") {
        const callbackRequest = buildManualCallbackRequest(
          input.parsed.callbackUrlBase,
          input.parsed.callbackCode ?? "sandbox-code",
          seenAuthorize ? authorizeState : "callback-before-authorize",
        );
        const callback = await runLoaderInSandbox({
          loader: input.callbackLoader,
          state,
          request: callbackRequest,
          fetchStubs: input.fetchStubs,
        });
        state = callback.nextState;
        steps.push(toManualStepResult("callback", callbackRequest.url, callback));
        continue;
      }

      // refresh は loader/path が揃う場合だけ実行対象として扱う。
      if (!input.refreshLoader || !input.parsed.refreshUrl) {
        continue;
      }
      const refresh = await runLoaderInSandbox({
        loader: input.refreshLoader,
        state,
        request: {
          url: input.parsed.refreshUrl,
          method: "GET",
        },
        fetchStubs: input.fetchStubs,
      });
      state = refresh.nextState;
      steps.push(toManualStepResult("refresh", input.parsed.refreshUrl, refresh));
    }

    const serializedSteps = await serializeOauthMixedStepResults(steps);
    const callbackIndex = order.indexOf("callback");
    const authorizeIndex = order.indexOf("authorize");
    const callbackStep = serializedSteps.find((step) => step.type === "callback");
    const checks =
      callbackStep && callbackIndex !== -1 && authorizeIndex !== -1 && callbackIndex < authorizeIndex
        ? [toSpecCheck("callback_before_authorize_must_reject", callbackStep)]
        : [];

    paths.push({
      order,
      steps: serializedSteps,
      violations: validateOauthSpec(
        `graph:${order.join("->")}`,
        checks,
        input.parsed.enableSpecValidation,
      ),
    });
  }

  return {
    paths,
    vulnerabilities: paths.flatMap((pathResult) => pathResult.violations),
  };
};

const buildManualCallbackRequest = (
  callbackUrlBase: string,
  code: string,
  state: string | null,
): { url: string; method: "GET" } => {
  const callbackUrl = new URL(callbackUrlBase);
  callbackUrl.searchParams.set("code", code);

  // state を欠落させるケースは query から state を除外する。
  if (state === null) {
    callbackUrl.searchParams.delete("state");
  } else {
    callbackUrl.searchParams.set("state", state);
  }

  return {
    url: callbackUrl.toString(),
    method: "GET",
  };
};

const toManualStepResult = (
  type: "authorize" | "callback" | "refresh",
  requestUrl: string,
  result: RunLoaderInSandboxResult,
): OauthSerializedStep => {
  const location = result.response.headers.get("Location");
  const state = location
    ? new URL(location, "https://sandbox.local").searchParams.get("state")
    : new URL(requestUrl, "https://sandbox.local").searchParams.get("state");

  return {
    type,
    requestUrl,
    status: result.response.status,
    location,
    state,
    body: "",
  };
};

const serializeOauthMixedStepResults = async (
  steps: Array<OauthTwoStepResult | OauthSerializedStep>,
): Promise<OauthSerializedStep[]> => {
  const serialized: OauthSerializedStep[] = [];

  for (const step of steps) {
    // 既に直列化済みのステップは body だけ後段で補完する。
    if ("status" in step && "body" in step) {
      serialized.push(step);
      continue;
    }

    const body = await step.response.text().catch(() => "");
    serialized.push({
      type: step.type,
      requestUrl: step.requestUrl,
      status: step.response.status,
      location: step.location,
      state: step.state,
      body,
    });
  }

  return serialized;
};

const toSpecCheck = (
  ruleId: OauthSpecRuleId,
  step: OauthSerializedStep,
): { ruleId: OauthSpecRuleId; step: OauthSerializedStep } => {
  return {
    ruleId,
    step,
  };
};

const validateOauthSpec = (
  attackId: string,
  checks: Array<{ ruleId: OauthSpecRuleId; step: OauthSerializedStep }>,
  enabled: boolean,
): OauthSpecViolation[] => {
  // spec validate 未指定時は判定を走らせず結果だけ返す。
  if (!enabled) {
    return [];
  }

  const violations: OauthSpecViolation[] = [];

  for (const check of checks) {
    // OAuth callback の拒否系判定は 4xx/5xx を reject として扱う。
    if (check.step.status >= 400) {
      continue;
    }

    violations.push({
      attackId,
      ruleId: check.ruleId,
      expected: "status >= 400 (reject)",
      actualStatus: check.step.status,
      stepType: check.step.type,
      vulnerability: true,
    });
  }

  return violations;
};

const permutations = <T,>(items: T[]): T[][] => {
  // 要素 1 件以下は並び替えが不要なためそのまま返す。
  if (items.length <= 1) {
    return [items];
  }

  const result: T[][] = [];

  for (let index = 0; index < items.length; index += 1) {
    const current = items[index];

    // index 範囲外は起こらないが、型安全のため undefined は除外する。
    if (current === undefined) {
      continue;
    }
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];

    for (const tail of permutations(rest)) {
      result.push([current, ...tail]);
    }
  }

  return result;
};

const withDefaultOauthEnvEntries = (
  entries: Array<[string, string]>,
): Array<[string, string]> => {
  const merged = [...entries];
  const hasAuthorizeUrl = merged.some(([key]) => key === "AUTHORIZE_URL");
  const hasAppOrigin = merged.some(([key]) => key === "APP_ORIGIN");

  // authorize URL 未指定時は GitHub OAuth authorize endpoint を既定値として補完する。
  if (!hasAuthorizeUrl) {
    merged.push(["AUTHORIZE_URL", "https://github.com/login/oauth/authorize"]);
  }

  // APP_ORIGIN 未指定時は sandbox URL を使って redirect_uri 生成を成立させる。
  if (!hasAppOrigin) {
    merged.push(["APP_ORIGIN", "https://app.test"]);
  }

  return merged;
};

const buildDefaultSandboxGlobals = (): Record<string, unknown> => {
  return {
    // createState は authorize で state 生成に使われるため固定値を返す。
    createState: () => "sandbox-state",
    // verifier/challenge は callback に渡さないが、authorize 実行の依存を満たす。
    createCodeVerifier: () => "sandbox-verifier",
    createCodeChallenge: (verifier: string) => `sandbox-challenge-${verifier}`,
  };
};

const buildSandboxOperations = (parsed: ParsedSingleCliArgs): SandboxOperation[] => {
  const operations: SandboxOperation[] = [
    {
      type: "request",
      id: parsed.requestId,
      request: {
        url: parsed.url,
        method: parsed.method,
      },
      fetchStubs: buildDefaultFetchStubs(parsed.fetchStubOverrides),
    },
  ];

  for (const ms of parsed.advanceMsEntries) {
    operations.push({
      type: "advance_time",
      ms,
    });
  }

  for (const target of parsed.replayTargets) {
    operations.push({
      type: "replay",
      target,
    });
  }

  return operations;
};

const serializeStepResults = async (
  steps: SandboxStepResult[],
): Promise<
  Array<
    | { type: "request"; id?: string; status: number; location: string | null; body: string }
    | { type: "advance_time"; fromMs: number; toMs: number }
    | { type: "replay"; target: string | number; status: number; location: string | null; body: string }
  >
> => {
  const serialized: Array<
    | { type: "request"; id?: string; status: number; location: string | null; body: string }
    | { type: "advance_time"; fromMs: number; toMs: number }
    | { type: "replay"; target: string | number; status: number; location: string | null; body: string }
  > = [];

  for (const step of steps) {
    // step 種別ごとにレスポンス有無が異なるため、出力形式を分ける。
    if (step.type === "advance_time") {
      serialized.push({
        type: "advance_time",
        fromMs: step.fromMs,
        toMs: step.toMs,
      });
      continue;
    }

    const body = await step.response.text().catch(() => "");

    // request step は replay より id 情報を持つため出力を分ける。
    if (step.type === "request") {
      serialized.push({
        type: "request",
        id: step.id,
        status: step.response.status,
        location: step.response.headers.get("Location"),
        body,
      });
      continue;
    }

    serialized.push({
      type: "replay",
      target: step.target,
      status: step.response.status,
      location: step.response.headers.get("Location"),
      body,
    });
  }

  return serialized;
};

const serializeOauthStepResults = async (
  steps: OauthTwoStepResult[],
): Promise<OauthSerializedStep[]> => {
  const serialized: OauthSerializedStep[] = [];

  for (const step of steps) {
    const body = await step.response.text().catch(() => "");
    serialized.push({
      type: step.type,
      requestUrl: step.requestUrl,
      status: step.response.status,
      location: step.location,
      state: step.state,
      body,
    });
  }

  return serialized;
};

// 直接実行時のみ CLI を起動し、テスト import 時は副作用を抑える。
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSandboxCli(process.argv.slice(2)).catch((error: unknown) => {
    // Error 型は message を優先し、それ以外は文字列化して表示する。
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  });
}
