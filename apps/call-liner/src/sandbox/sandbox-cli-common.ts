import type { SessionLike } from "./load-route-loader-from-file";
import type { SandboxFetchStub } from "./runtime";

export type DefaultFetchStubOverrides = {
  githubAccessToken?: string;
  githubRefreshToken?: string;
};

/**
 * CLI フラグの次値を取得し、未指定なら説明付きで失敗させる。
 *
 * 入力例:
 * - flag: "--url", value: "https://app.test"
 * 出力例:
 * - "https://app.test"
 */
export const requireNextValue = (flag: string, value: string | undefined): string => {
  // フラグ値が無い場合は CLI 入力ミスなので即時に説明付きエラーを返す。
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
};

/**
 * `key=value` 文字列をタプルへ変換する。
 *
 * 入力例:
 * - raw: "APP_ORIGIN=https://app.test", flag: "--env"
 * 出力例:
 * - ["APP_ORIGIN", "https://app.test"]
 */
export const parseKeyValue = (raw: string, flag: string): [string, string] => {
  const equalIndex = raw.indexOf("=");

  // key=value 形式でない入力は曖昧になるため拒否する。
  if (equalIndex <= 0) {
    throw new Error(`Expected key=value for ${flag}, but received: ${raw}`);
  }

  const key = raw.slice(0, equalIndex);
  const value = raw.slice(equalIndex + 1);
  return [key, value];
};

/**
 * SessionLike 実装をメモリ上 Map で作成する。
 *
 * 入力例:
 * - sessionRecord: new Map([["oauth:state", "state-1"]])
 * 出力例:
 * - get/set/unset を持つ SessionLike
 */
export const createInMemorySession = (
  sessionRecord: Map<string, unknown>,
): SessionLike => {
  return {
    get: (key: string) => sessionRecord.get(key),
    set: (key: string, value: unknown) => {
      sessionRecord.set(key, value);
    },
    // callback 側で state 消費時に session.unset を呼ぶ実装へ対応する。
    unset: (key: string) => {
      sessionRecord.delete(key);
    },
  };
};

/**
 * sessionRecord から Set-Cookie ヘッダ文字列を構築する。
 *
 * 入力例:
 * - sessionRecord: Map([["oauth:state", "state-1"]]), maxAge: 60
 * 出力例:
 * - "session=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=60"
 */
export const toSetCookieHeader = (
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

/**
 * process.env を一時的に上書きし、復元用の元値一覧を返す。
 *
 * 入力例:
 * - entries: [["APP_ORIGIN", "https://app.test"]]
 * 出力例:
 * - [["APP_ORIGIN", "https://app.test", undefined]]
 */
export const applyEnvOverrides = (
  entries: Array<[string, string]>,
): Array<[string, string, string | undefined]> => {
  const originals: Array<[string, string, string | undefined]> = [];

  for (const [key, value] of entries) {
    originals.push([key, value, process.env[key]]);
    process.env[key] = value;
  }

  return originals;
};

/**
 * applyEnvOverrides で上書きした process.env を元値へ戻す。
 *
 * 入力例:
 * - originals: [["APP_ORIGIN", "https://app.test", undefined]]
 * 出力例:
 * - process.env.APP_ORIGIN が削除される
 */
export const restoreEnvOverrides = (
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

/**
 * OAuth callback 検証向けの既定 fetch スタブを返す。
 *
 * 入力例:
 * - なし
 * 出力例:
 * - access_token/user API 用スタブ 2 件
 */
export const buildDefaultFetchStubs = (
  overrides?: DefaultFetchStubOverrides,
): SandboxFetchStub[] => {
  return [
    {
      matcher: "https://github.com/login/oauth/access_token",
      response: () =>
        new Response(JSON.stringify(buildTokenResponseBody(overrides)), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
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

const buildTokenResponseBody = (
  overrides?: DefaultFetchStubOverrides,
): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    access_token: overrides?.githubAccessToken ?? "sandbox-access-token",
    token_type: "bearer",
    scope: "read:user",
  };

  // refresh token を明示指定した場合だけレスポンスへ含める。
  if (overrides?.githubRefreshToken) {
    body.refresh_token = overrides.githubRefreshToken;
  }

  return body;
};
