import { pathToFileURL } from "node:url";
import { loadRouteLoaderFromFile, type SessionLike } from "./load-route-loader-from-file";
import { createPhase1SandboxState, type SandboxFetchStub } from "./phase1";
import {
  runPhase4Sandbox,
  type Phase4CallbackStateStrategy,
  type Phase4StepResult,
} from "./phase4";

type ParsedCliArgs = {
  authorizeLoaderFile: string;
  callbackLoaderFile: string;
  authorizeUrl: string;
  callbackUrlBase: string;
  callbackCode?: string;
  callbackStateStrategy: Phase4CallbackStateStrategy;
  callbackState?: string;
  sessionEntries: Array<[string, string]>;
  envEntries: Array<[string, string]>;
};

/**
 * Phase 4 の authorize -> callback 2 ステップ探索を CLI から実行する。
 *
 * 入力例:
 * - ["--authorize-loader-file", "/tmp/authorize.tsx", "--callback-loader-file", "/tmp/callback.tsx", "--authorize-url", "https://app.test/auth/github", "--callback-url-base", "https://app.test/auth/github/callback"]
 * 出力例:
 * - 標準出力に { steps, callbackRequest, cookieJar, trace } を JSON 表示
 */
export const runPhase4Cli = async (rawArgs: string[]): Promise<void> => {
  const parsed = parsePhase4CliArgs(rawArgs);
  const originalEnvValues = applyEnvOverrides(
    withDefaultPhase4EnvEntries(parsed.envEntries),
  );

  try {
    const sessionRecord = new Map<string, unknown>(parsed.sessionEntries);
    const state = createPhase1SandboxState();
    const runtimeDeps = {
      redirect: (url: string, init?: ResponseInit) => {
        const headers = new Headers(init?.headers);
        headers.set("Location", url);
        return new Response(null, { ...init, status: init?.status ?? 302, headers });
      },
      getSession: async () => createInMemorySession(sessionRecord),
      commitSession: async (session: SessionLike, options?: { maxAge?: number }) =>
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

    const result = await runPhase4Sandbox({
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

    console.log(
      JSON.stringify(
        {
          steps: await serializeStepResults(result.steps),
          callbackRequest: result.callbackRequest,
          cookieJar: result.nextState.cookieJar,
          trace: result.nextState.trace,
        },
        null,
        2,
      ),
    );
  } finally {
    restoreEnvOverrides(originalEnvValues);
  }
};

const parsePhase4CliArgs = (rawArgs: string[]): ParsedCliArgs => {
  let authorizeLoaderFile = "";
  let callbackLoaderFile = "";
  let authorizeUrl = "";
  let callbackUrlBase = "";
  let callbackCode: string | undefined;
  let callbackStateStrategy: Phase4CallbackStateStrategy = "match_authorize";
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

    // authorize の route module は 1 ステップ目実行に必須。
    if (arg === "--authorize-loader-file") {
      authorizeLoaderFile = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // callback の route module は 2 ステップ目実行に必須。
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

    // callback の URL ベースを指定し、query は Phase 4 側で合成する。
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

const parseStateMode = (raw: string): Phase4CallbackStateStrategy => {
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

const requireNextValue = (flag: string, value: string | undefined): string => {
  // フラグ値が無い場合は CLI 入力ミスなので即時に説明付きエラーを返す。
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
};

const parseKeyValue = (raw: string, flag: string): [string, string] => {
  const equalIndex = raw.indexOf("=");

  // key=value 形式でない入力は曖昧になるため拒否する。
  if (equalIndex <= 0) {
    throw new Error(`Expected key=value for ${flag}, but received: ${raw}`);
  }

  const key = raw.slice(0, equalIndex);
  const value = raw.slice(equalIndex + 1);
  return [key, value];
};

const createInMemorySession = (sessionRecord: Map<string, unknown>): SessionLike => {
  return {
    get: (key: string) => sessionRecord.get(key),
    set: (key: string, value: unknown) => {
      sessionRecord.set(key, value);
    },
  };
};

const toSetCookieHeader = (
  sessionRecord: Map<string, unknown>,
  _session: SessionLike,
  maxAge?: number,
): string => {
  const payload = JSON.stringify(Object.fromEntries(sessionRecord.entries()));
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const parts = [`session=${encoded}`, "Path=/", "HttpOnly", "SameSite=Lax"];

  // maxAge 指定がある場合だけ Set-Cookie に反映する。
  if (typeof maxAge === "number") {
    parts.push(`Max-Age=${maxAge}`);
  }

  return parts.join("; ");
};

const applyEnvOverrides = (
  entries: Array<[string, string]>,
): Array<[string, string, string | undefined]> => {
  const originals: Array<[string, string, string | undefined]> = [];

  for (const [key, value] of entries) {
    originals.push([key, value, process.env[key]]);
    process.env[key] = value;
  }

  return originals;
};

const withDefaultPhase4EnvEntries = (
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

const restoreEnvOverrides = (
  originals: Array<[string, string, string | undefined]>,
): void => {
  for (const [key, , originalValue] of originals) {
    // 元値が無いキーは削除し、あったキーは復元する。
    if (originalValue === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = originalValue;
  }
};

const buildDefaultFetchStubs = (): SandboxFetchStub[] => {
  return [
    {
      matcher: "https://github.com/login/oauth/access_token",
      response: () =>
        new Response(
          JSON.stringify({
            access_token: "sandbox-access-token",
            token_type: "bearer",
            scope: "read:user",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
    },
    {
      matcher: "https://api.github.com/user",
      response: () =>
        new Response(
          JSON.stringify({
            id: 1,
            login: "sandbox-user",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
    },
  ];
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

const serializeStepResults = async (
  steps: Phase4StepResult[],
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
  runPhase4Cli(process.argv.slice(2)).catch((error: unknown) => {
    // Error 型は message を優先し、それ以外は文字列化して表示する。
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  });
}
