import { pathToFileURL } from "node:url";
import { loadRouteLoaderFromFile, type SessionLike } from "./load-route-loader-from-file";
import { createSandboxState, type SandboxFetchStub } from "./runtime";
import {
  runSandbox,
  type SandboxOperation,
  type SandboxStepResult,
} from "./executor";

type ParsedCliArgs = {
  loaderFile: string;
  url: string;
  method: string;
  requestId: string;
  sessionEntries: Array<[string, string]>;
  envEntries: Array<[string, string]>;
  advanceMsEntries: number[];
  replayTargets: Array<string | number>;
};

/**
 * 統合サンドボックスを CLI から実行する。
 *
 * 入力例:
 * - ["--loader-file", "/tmp/callback.tsx", "--url", "https://app.test/auth/github/callback?code=a&state=b", "--advance-ms", "61000", "--replay", "callback"]
 * 出力例:
 * - 標準出力に { steps, cookieJar, trace } を JSON 表示
 */
export const runSandboxCli = async (rawArgs: string[]): Promise<void> => {
  const parsed = parseSandboxCliArgs(rawArgs);
  const originalEnvValues = applyEnvOverrides(parsed.envEntries);

  try {
    const sessionRecord = new Map<string, unknown>(parsed.sessionEntries);
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

    console.log(
      JSON.stringify(
        {
          steps: await serializeStepResults(result.steps),
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

const parseSandboxCliArgs = (rawArgs: string[]): ParsedCliArgs => {
  let loaderFile = "";
  let url = "";
  let method = "GET";
  let requestId = "initial";
  const sessionEntries: Array<[string, string]> = [];
  const envEntries: Array<[string, string]> = [];
  const advanceMsEntries: number[] = [];
  const replayTargets: Array<string | number> = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const nextValue = rawArgs[index + 1];

    // pnpm 経由実行では区切り文字 `--` が含まれるため読み飛ばす。
    if (arg === "--") {
      continue;
    }

    // `--loader-file` は対象 route module を解決する必須パラメータ。
    if (arg === "--loader-file") {
      loaderFile = requireNextValue(arg, nextValue);
      index += 1;
      continue;
    }

    // `--url` は Request.url を作る必須パラメータ。
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

    throw new Error(`Unknown argument: ${arg}`);
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
    loaderFile,
    url,
    method,
    requestId,
    sessionEntries,
    envEntries,
    advanceMsEntries,
    replayTargets,
  };
};

const buildSandboxOperations = (parsed: ParsedCliArgs): SandboxOperation[] => {
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
  const parts = ["session=" + encoded, "Path=/", "HttpOnly", "SameSite=Lax"];

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
