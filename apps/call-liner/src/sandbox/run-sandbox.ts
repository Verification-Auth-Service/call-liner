import { pathToFileURL } from "node:url";
import { loadRouteLoaderFromFile } from "./load-route-loader-from-file";
import { createSandboxState } from "./runtime";
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
  advanceMsEntries: number[];
  replayTargets: Array<string | number>;
};

type ParsedOauthTwoStepCliArgs = {
  scenario: "oauth_two_step";
  authorizeLoaderFile: string;
  callbackLoaderFile: string;
  authorizeUrl: string;
  callbackUrlBase: string;
  callbackCode?: string;
  callbackStateStrategy: OauthCallbackStateStrategy;
  callbackState?: string;
  sessionEntries: Array<[string, string]>;
  envEntries: Array<[string, string]>;
};

type ParsedCliArgs = ParsedSingleCliArgs | ParsedOauthTwoStepCliArgs;

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
  let authorizeUrl = "";
  let callbackUrlBase = "";
  let callbackCode: string | undefined;
  let callbackStateStrategy: OauthCallbackStateStrategy = "match_authorize";
  let callbackState: string | undefined;

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

    throw new Error(`Unknown argument: ${arg}`);
  }

  const hasOauthSpecificArgs =
    authorizeLoaderFile.length > 0 ||
    callbackLoaderFile.length > 0 ||
    authorizeUrl.length > 0 ||
    callbackUrlBase.length > 0 ||
    callbackCode !== undefined ||
    callbackState !== undefined ||
    callbackStateStrategy !== "match_authorize";
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
    authorizeUrl,
    callbackUrlBase,
    callbackCode,
    callbackStateStrategy,
    callbackState,
    sessionEntries,
    envEntries,
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
  steps: Array<{
    type: "authorize" | "callback";
    requestUrl: string;
    status: number;
    location: string | null;
    state: string | null;
    body: string;
  }>;
  callbackRequest: {
    url: string;
    method?: string;
    headers?: Headers | Array<[string, string]> | Record<string, string> | undefined;
    body?: RequestInit["body"];
  };
  cookieJar: ReturnType<typeof createSandboxState>["cookieJar"];
  trace: ReturnType<typeof createSandboxState>["trace"];
}> => {
  const state = createSandboxState();
  const runtimeDeps = {
    redirect: (url: string, init?: ResponseInit) => {
      const headers = new Headers(init?.headers);
      headers.set("Location", url);
      return new Response(null, { ...init, status: init?.status ?? 302, headers });
    },
    getSession: async () => createInMemorySession(sessionRecord),
    commitSession: async (session: { get: (key: string) => unknown; set: (key: string, value: unknown) => void }, options?: { maxAge?: number }) =>
      toSetCookieHeader(sessionRecord, session, options?.maxAge),
    globals: buildDefaultSandboxGlobals(),
  };
  const authorizeLoader = await loadRouteLoaderFromFile(
    parsed.authorizeLoaderFile,
    runtimeDeps,
  );
  const callbackLoader = await loadRouteLoaderFromFile(
    parsed.callbackLoaderFile,
    runtimeDeps,
  );

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
    authorizeFetchStubs: buildDefaultFetchStubs(),
    callbackFetchStubs: buildDefaultFetchStubs(),
  });

  return {
    steps: await serializeOauthStepResults(result.steps),
    callbackRequest: result.callbackRequest,
    cookieJar: result.nextState.cookieJar,
    trace: result.nextState.trace,
  };
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
      fetchStubs: buildDefaultFetchStubs(),
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
): Promise<
  Array<{
    type: "authorize" | "callback";
    requestUrl: string;
    status: number;
    location: string | null;
    state: string | null;
    body: string;
  }>
> => {
  const serialized: Array<{
    type: "authorize" | "callback";
    requestUrl: string;
    status: number;
    location: string | null;
    state: string | null;
    body: string;
  }> = [];

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
