import {
  runLoaderInSandbox,
  type LoaderRequestInput,
  type RunLoaderInSandboxResult,
  type SandboxFetchStub,
  type SandboxLoader,
  type SandboxState,
} from "./runtime";

export type OauthCallbackStateStrategy =
  | "match_authorize"
  | "tampered"
  | "missing"
  | "fixed";

export type OauthTwoStepResult = {
  type: "authorize" | "callback";
  response: Response;
  requestUrl: string;
  location: string | null;
  state: string | null;
};

export type RunOauthTwoStepSandboxOptions = {
  authorizeLoader: SandboxLoader;
  callbackLoader: SandboxLoader;
  state: SandboxState;
  authorizeRequest: LoaderRequestInput;
  callbackUrlBase: string;
  callbackCode?: string;
  callbackStateStrategy?: OauthCallbackStateStrategy;
  fixedCallbackState?: string;
  authorizeParams?: Record<string, string>;
  callbackParams?: Record<string, string>;
  authorizeContext?: unknown;
  callbackContext?: unknown;
  authorizeFetchStubs?: SandboxFetchStub[];
  callbackFetchStubs?: SandboxFetchStub[];
};

export type RunOauthTwoStepSandboxResult = {
  nextState: SandboxState;
  steps: OauthTwoStepResult[];
  callbackRequest: LoaderRequestInput;
};

/**
 * OAuth authorize -> callback の 2 ステップ探索を実行する。
 *
 * 入力例:
 * - {
 *     authorizeRequest: { url: "https://app.test/auth/github" },
 *     callbackUrlBase: "https://app.test/auth/github/callback",
 *     callbackStateStrategy: "match_authorize"
 *   }
 * 出力例:
 * - steps: [{ type: "authorize", ... }, { type: "callback", ... }]
 * - callbackRequest.url: "https://app.test/auth/github/callback?code=sandbox-code&state=state-1"
 */
export const runOauthTwoStepSandbox = async (
  options: RunOauthTwoStepSandboxOptions,
): Promise<RunOauthTwoStepSandboxResult> => {
  let workingState = cloneState(options.state);
  const authorizeResult = await runLoaderInSandbox({
    loader: options.authorizeLoader,
    state: workingState,
    request: options.authorizeRequest,
    params: options.authorizeParams,
    context: options.authorizeContext,
    fetchStubs: options.authorizeFetchStubs,
  });
  workingState = authorizeResult.nextState;
  const authorizeLocation = authorizeResult.response.headers.get("Location");
  const authorizeState = readStateFromLocation(authorizeLocation);
  const callbackRequest = buildCallbackRequest({
    callbackUrlBase: options.callbackUrlBase,
    callbackCode: options.callbackCode,
    callbackStateStrategy: options.callbackStateStrategy ?? "match_authorize",
    fixedCallbackState: options.fixedCallbackState,
    authorizeState,
  });

  const callbackResult = await runLoaderInSandbox({
    loader: options.callbackLoader,
    state: workingState,
    request: callbackRequest,
    params: options.callbackParams,
    context: options.callbackContext,
    fetchStubs: options.callbackFetchStubs,
  });
  workingState = callbackResult.nextState;
  const callbackLocation = callbackResult.response.headers.get("Location");
  const callbackState = readStateFromLocation(callbackRequest.url);

  return {
    nextState: workingState,
    steps: [
      toOauthStepResult("authorize", options.authorizeRequest.url, authorizeResult),
      toOauthStepResult(
        "callback",
        callbackRequest.url,
        callbackResult,
        callbackLocation,
        callbackState,
      ),
    ],
    callbackRequest,
  };
};

const toOauthStepResult = (
  type: "authorize" | "callback",
  requestUrl: string,
  result: RunLoaderInSandboxResult,
  location = result.response.headers.get("Location"),
  state = readStateFromLocation(location),
): OauthTwoStepResult => {
  return {
    type,
    response: result.response.clone(),
    requestUrl,
    location,
    state,
  };
};

const buildCallbackRequest = (input: {
  callbackUrlBase: string;
  callbackCode?: string;
  callbackStateStrategy: OauthCallbackStateStrategy;
  fixedCallbackState?: string;
  authorizeState: string | null;
}): LoaderRequestInput => {
  const callbackUrl = new URL(input.callbackUrlBase);
  const callbackCode = input.callbackCode ?? "sandbox-code";
  callbackUrl.searchParams.set("code", callbackCode);
  const callbackState = resolveCallbackState(input);

  // 欠落ケースの再現では state を送らずに callback へ進める。
  if (callbackState === null) {
    callbackUrl.searchParams.delete("state");
  } else {
    callbackUrl.searchParams.set("state", callbackState);
  }

  return {
    method: "GET",
    url: callbackUrl.toString(),
  };
};

const resolveCallbackState = (input: {
  callbackStateStrategy: OauthCallbackStateStrategy;
  fixedCallbackState?: string;
  authorizeState: string | null;
}): string | null => {
  // authorize 由来 state を使うのが 2 ステップ探索の基準挙動。
  if (input.callbackStateStrategy === "match_authorize") {
    // authorize redirect に state がない場合は比較条件が作れない。
    if (input.authorizeState === null) {
      throw new Error(
        "authorize response does not contain state query, cannot use match_authorize",
      );
    }

    return input.authorizeState;
  }

  // 改ざんケースでは authorize state と異なる値を callback に注入する。
  if (input.callbackStateStrategy === "tampered") {
    // 明示指定があれば固定値で改ざん状態を再現する。
    if (input.fixedCallbackState !== undefined) {
      return input.fixedCallbackState;
    }

    return input.authorizeState ? `${input.authorizeState}-tampered` : "tampered-state";
  }

  // 欠落ケースは callback 側バリデーションの挙動確認用に使う。
  if (input.callbackStateStrategy === "missing") {
    return null;
  }

  // 固定値ケースでは明示 state が無いと再現条件を満たせない。
  if (input.fixedCallbackState === undefined) {
    throw new Error("fixed state strategy requires fixedCallbackState");
  }

  return input.fixedCallbackState;
};

const readStateFromLocation = (location: string | null): string | null => {
  // redirect 先がないレスポンスは state 抽出元が無いため null 扱いにする。
  if (!location) {
    return null;
  }

  const url = new URL(location, "https://sandbox.local");
  return url.searchParams.get("state");
};

const cloneState = (state: SandboxState): SandboxState => {
  return {
    nowMs: state.nowMs,
    cookieJar: { ...state.cookieJar },
    trace: [...state.trace],
  };
};
