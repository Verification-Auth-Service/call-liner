type HeadersInitLike =
  | Headers
  | Array<[string, string]>
  | Record<string, string>
  | undefined;

export type SandboxTraceEvent =
  | {
      type: "request";
      url: string;
      method: string;
    }
  | {
      type: "fetch";
      url: string;
      method: string;
    }
  | {
      type: "response";
      status: number;
    }
  | {
      type: "cookie_set";
      name: string;
      expiresAtMs: number | null;
    }
  | {
      type: "time_advanced";
      fromMs: number;
      toMs: number;
    }
  | {
      type: "cookie_expired";
      name: string;
      expiredAtMs: number;
    }
  | {
      type: "replay";
      target: string | number;
      url: string;
      method: string;
    };

export type SandboxCookie = {
  name: string;
  value: string;
  path: string;
  expiresAtMs: number | null;
};

export type SandboxState = {
  nowMs: number;
  cookieJar: Record<string, SandboxCookie>;
  trace: SandboxTraceEvent[];
};

export type LoaderRequestInput = {
  url: string;
  method?: string;
  headers?: HeadersInitLike;
  body?: RequestInit["body"];
};

export type SandboxFetchStubMatcher =
  | string
  | RegExp
  | ((url: string, init: RequestInit | undefined) => boolean);

export type SandboxFetchStub = {
  matcher: SandboxFetchStubMatcher;
  response:
    | Response
    | ((url: string, init: RequestInit | undefined) => Response | Promise<Response>);
};

export type SandboxLoaderArgs = {
  request: Request;
  params?: Record<string, string>;
  context?: unknown;
};

export type SandboxLoader = (
  args: SandboxLoaderArgs,
) => Response | Promise<Response>;

export type RunLoaderInSandboxOptions = {
  loader: SandboxLoader;
  request: LoaderRequestInput;
  state: SandboxState;
  params?: Record<string, string>;
  context?: unknown;
  fetchStubs?: SandboxFetchStub[];
};

export type RunLoaderInSandboxResult = {
  response: Response;
  nextState: SandboxState;
};

/**
 * Phase 1 向けのサンドボックス状態を作る。
 *
 * 入力例: { nowMs: 1_700_000_000_000 }
 * 出力例: { nowMs: 1700000000000, cookieJar: {}, trace: [] }
 */
export const createPhase1SandboxState = (
  input?: Partial<SandboxState>,
): SandboxState => {
  return {
    nowMs: input?.nowMs ?? Date.now(),
    cookieJar: input?.cookieJar ? { ...input.cookieJar } : {},
    trace: input?.trace ? [...input.trace] : [],
  };
};

/**
 * loader を関数レベルで直接実行し、Cookie と Trace を次状態へ反映する。
 *
 * 入力例:
 * - loader: async ({ request }) => new Response("ok")
 * - request.url: "https://example.test/auth/callback?code=abc"
 * 出力例:
 * - response.status: 200
 * - nextState.trace: [{ type: "request", ... }, { type: "response", ... }]
 */
export const runLoaderInPhase1Sandbox = async (
  options: RunLoaderInSandboxOptions,
): Promise<RunLoaderInSandboxResult> => {
  const nextState = cloneState(options.state);
  const request = createRequestWithCookieJar(options.request, nextState);
  const fetchStubs = options.fetchStubs ?? [];
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;

  nextState.trace.push({
    type: "request",
    url: request.url,
    method: request.method,
  });

  // loader 内で現在時刻を参照したときに、サンドボックス時刻を返すよう固定する。
  Date.now = () => nextState.nowMs;
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = resolveInputUrl(input);
    const method = init?.method ?? "GET";

    nextState.trace.push({
      type: "fetch",
      url,
      method,
    });

    const matchedStub = findFetchStub(fetchStubs, url, init);

    // スタブが無い外部通信は探索の再現性を崩すため、明示的に失敗させる。
    if (!matchedStub) {
      throw new Error(`Fetch stub not found for URL: ${url}`);
    }

    // 関数スタブを許可し、入力に応じたレスポンス分岐を表現できるようにする。
    if (typeof matchedStub.response === "function") {
      return matchedStub.response(url, init);
    }

    return matchedStub.response.clone();
  };

  try {
    const response = await options.loader({
      request,
      params: options.params,
      context: options.context,
    });

    applySetCookieHeadersToState(response.headers, nextState);
    nextState.trace.push({
      type: "response",
      status: response.status,
    });

    return {
      response,
      nextState,
    };
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
};

const cloneState = (state: SandboxState): SandboxState => {
  return {
    nowMs: state.nowMs,
    cookieJar: { ...state.cookieJar },
    trace: [...state.trace],
  };
};

const createRequestWithCookieJar = (
  input: LoaderRequestInput,
  state: SandboxState,
): Request => {
  const method = input.method ?? "GET";
  const headers = new Headers(input.headers);
  const cookieHeaderFromJar = buildCookieHeader(state.cookieJar, state.nowMs);
  const currentCookie = headers.get("cookie");

  // 呼び出し側の cookie 指定がある場合は、Jar の cookie と連結して両方を送る。
  if (cookieHeaderFromJar.length > 0) {
    headers.set(
      "cookie",
      currentCookie ? `${currentCookie}; ${cookieHeaderFromJar}` : cookieHeaderFromJar,
    );
  }

  return new Request(input.url, {
    method,
    headers,
    body: input.body,
  });
};

const buildCookieHeader = (
  cookieJar: Record<string, SandboxCookie>,
  nowMs: number,
): string => {
  const parts: string[] = [];

  for (const cookie of Object.values(cookieJar)) {
    // 期限付き cookie は有効期限を超えた時点で送信しない。
    if (cookie.expiresAtMs !== null && cookie.expiresAtMs <= nowMs) {
      continue;
    }

    parts.push(`${cookie.name}=${cookie.value}`);
  }

  return parts.join("; ");
};

const resolveInputUrl = (input: string | URL | Request): string => {
  // string の場合は URL 文字列としてそのまま扱う。
  if (typeof input === "string") {
    return input;
  }

  // URL オブジェクトは href を正規化済み文字列として利用できる。
  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
};

const findFetchStub = (
  stubs: SandboxFetchStub[],
  url: string,
  init: RequestInit | undefined,
): SandboxFetchStub | undefined => {
  for (const stub of stubs) {
    if (matchesFetchStub(stub.matcher, url, init)) {
      return stub;
    }
  }

  return undefined;
};

const matchesFetchStub = (
  matcher: SandboxFetchStubMatcher,
  url: string,
  init: RequestInit | undefined,
): boolean => {
  // 文字列マッチは startsWith にして、クエリ違いのエンドポイント探索を許可する。
  if (typeof matcher === "string") {
    return url.startsWith(matcher);
  }

  // 正規表現マッチは URL 全体を対象に評価する。
  if (matcher instanceof RegExp) {
    return matcher.test(url);
  }

  return matcher(url, init);
};

const applySetCookieHeadersToState = (
  headers: Headers,
  state: SandboxState,
): void => {
  const setCookieHeaders = readSetCookieHeaders(headers);

  for (const setCookieHeader of setCookieHeaders) {
    const parsedCookie = parseSetCookieHeader(setCookieHeader, state.nowMs);

    // 構文が壊れた Set-Cookie は再現性優先で無視し、実行は継続する。
    if (!parsedCookie) {
      continue;
    }

    // `Max-Age=0` 等は削除命令として扱い、Jar から除去する。
    if (parsedCookie.deleteCookie) {
      delete state.cookieJar[parsedCookie.name];
      continue;
    }

    state.cookieJar[parsedCookie.name] = {
      name: parsedCookie.name,
      value: parsedCookie.value,
      path: parsedCookie.path,
      expiresAtMs: parsedCookie.expiresAtMs,
    };
    state.trace.push({
      type: "cookie_set",
      name: parsedCookie.name,
      expiresAtMs: parsedCookie.expiresAtMs,
    });
  }
};

const readSetCookieHeaders = (headers: Headers): string[] => {
  const headersWithGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };

  // Node/undici の getSetCookie が使える場合は、複数 Set-Cookie を正しく取得する。
  if (typeof headersWithGetSetCookie.getSetCookie === "function") {
    return headersWithGetSetCookie.getSetCookie();
  }

  const singleSetCookie = headers.get("set-cookie");

  // フォールバックでは 1 件のみ取得し、複数指定の厳密分解は Phase 2 で扱う。
  if (!singleSetCookie) {
    return [];
  }

  return [singleSetCookie];
};

type ParsedSetCookie = {
  name: string;
  value: string;
  path: string;
  expiresAtMs: number | null;
  deleteCookie: boolean;
};

const parseSetCookieHeader = (
  setCookieHeader: string,
  nowMs: number,
): ParsedSetCookie | null => {
  const parts = setCookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  // 先頭に name=value が無い文字列は cookie として扱えないため除外する。
  if (parts.length === 0 || !parts[0].includes("=")) {
    return null;
  }

  const [rawName, ...valueParts] = parts[0].split("=");
  const name = rawName.trim();
  const value = valueParts.join("=");
  let path = "/";
  let expiresAtMs: number | null = null;
  let deleteCookie = false;

  // name が空の cookie は HTTP 仕様上も不正なので採用しない。
  if (name.length === 0) {
    return null;
  }

  for (const attribute of parts.slice(1)) {
    const [rawKey, ...rawAttributeValue] = attribute.split("=");
    const key = rawKey.trim().toLowerCase();
    const attributeValue = rawAttributeValue.join("=").trim();

    // Path が指定された場合は送信スコープ再現のため保存する。
    if (key === "path" && attributeValue.length > 0) {
      path = attributeValue;
      continue;
    }

    // Max-Age を優先し、0 以下は削除命令として扱う。
    if (key === "max-age") {
      const seconds = Number.parseInt(attributeValue, 10);

      // 数値解釈できるときだけ期限計算に使う。
      if (!Number.isNaN(seconds)) {
        if (seconds <= 0) {
          deleteCookie = true;
        } else {
          expiresAtMs = nowMs + seconds * 1000;
        }
      }

      continue;
    }

    // Expires が有効な日時なら期限として保存する。
    if (key === "expires" && attributeValue.length > 0) {
      const parsedTime = Date.parse(attributeValue);

      // 不正な日付は無視して他属性の評価を継続する。
      if (!Number.isNaN(parsedTime)) {
        expiresAtMs = parsedTime;
        // 過去日時の expires は削除相当として扱う。
        if (parsedTime <= nowMs) {
          deleteCookie = true;
        }
      }
    }
  }

  return {
    name,
    value,
    path,
    expiresAtMs,
    deleteCookie,
  };
};
