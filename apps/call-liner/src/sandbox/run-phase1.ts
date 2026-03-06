import { pathToFileURL } from "node:url";
import { loadRouteLoaderFromFile, type SessionLike } from "./load-route-loader-from-file";
import {
  createPhase1SandboxState,
  runLoaderInPhase1Sandbox,
  type SandboxFetchStub,
} from "./phase1";

type ParsedCliArgs = {
  loaderFile: string;
  url: string;
  method: string;
  sessionEntries: Array<[string, string]>;
  envEntries: Array<[string, string]>;
};

/**
 * Phase 1 の関数レベルサンドボックスを CLI から実行する。
 *
 * 入力例:
 * - ["--loader-file", "/tmp/callback.tsx", "--url", "https://app.test/auth/github/callback?code=a&state=b"]
 * 出力例:
 * - 標準出力に { status, location, cookieJar, trace } を JSON 表示
 */
export const runPhase1Cli = async (rawArgs: string[]): Promise<void> => {
  const parsed = parsePhase1CliArgs(rawArgs);
  const originalEnvValues = applyEnvOverrides(parsed.envEntries);

  try {
    const sessionRecord = new Map<string, unknown>(parsed.sessionEntries);
    const state = createPhase1SandboxState();
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
    const fetchStubs = buildDefaultFetchStubs();

    const result = await runLoaderInPhase1Sandbox({
      loader,
      state,
      request: {
        url: parsed.url,
        method: parsed.method,
      },
      fetchStubs,
    });

    const responseBody = await result.response.text().catch(() => "");

    console.log(
      JSON.stringify(
        {
          status: result.response.status,
          location: result.response.headers.get("Location"),
          setCookie: result.response.headers.get("Set-Cookie"),
          body: responseBody,
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

const parsePhase1CliArgs = (rawArgs: string[]): ParsedCliArgs => {
  let loaderFile = "";
  let url = "";
  let method = "GET";
  const sessionEntries: Array<[string, string]> = [];
  const envEntries: Array<[string, string]> = [];

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
    sessionEntries,
    envEntries,
  };
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
  runPhase1Cli(process.argv.slice(2)).catch((error: unknown) => {
    // Error 型は message を優先し、それ以外は文字列化して表示する。
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  });
}
