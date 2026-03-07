import type {
  ActionSpaceEntrypoint,
  ActionSpaceExternalIo,
  ActionSpaceGuard,
  ActionSpaceReport,
} from "./build-action-space-report";

export type AttackDslFetchStub = {
  matcher: string;
  response: {
    status: number;
    body: string;
    headers?: Record<string, string>;
  };
};

export type AttackDslOperation =
  | {
      id: string;
      at: number;
      expect: string[];
      derivedFrom: {
        entrypointId: string;
      };
      type: "request";
      request: {
        url: string;
        method: "GET" | "POST";
      };
      session: Record<string, string>;
      fetchStubs?: AttackDslFetchStub[];
      note: string;
    }
  | {
      id: string;
      at: number;
      expect: string[];
      derivedFrom: {
        entrypointId: string;
      };
      type: "advance_time";
      ms: number;
      note: string;
    }
  | {
      id: string;
      at: number;
      expect: string[];
      derivedFrom: {
        entrypointId: string;
      };
      type: "replay";
      target: string;
      note: string;
    };

export type AttackDslScenario = {
  id: string;
  entrypointId: string;
  routePath: string;
  title: string;
  description: string;
  operations: AttackDslOperation[];
  expectedPolicyIds: string[];
};

export type AttackDslFindingCategory = "inconclusive" | "missing_or_suspect";

export type AttackDslRecommendedAction =
  | "add_annotations"
  | "rewrite_to_framework_convention"
  | "manual_minimum_dsl_completion"
  | "fix_implementation_gap";

export type AttackDslFinding = {
  id: string;
  entrypointId: string;
  routePath: string;
  category: AttackDslFindingCategory;
  title: string;
  detail: string;
  recommendedAction: AttackDslRecommendedAction;
};

export type AttackDslReport = {
  version: 1;
  dslVersion: 2;
  generatedAt: string;
  summary: {
    callbackEntrypoints: number;
    scenarios: number;
    generated: number;
    inconclusive: number;
    missingOrSuspect: number;
  };
  generated: AttackDslScenario[];
  inconclusive: AttackDslFinding[];
  missingOrSuspect: AttackDslFinding[];
  scenarios: AttackDslScenario[];
};

type BuildAttackDslReportOptions = {
  actionSpace: ActionSpaceReport;
  generatedAt?: string;
};

type CallbackIoSignals = {
  tokenEndpoint?: string;
  resourceEndpoint?: string;
};

type EntrypointAnalysisSignals = {
  hasStateComparison: boolean;
  hasStateSessionRead: boolean;
  hasVerifierSessionRead: boolean;
  hasVerifierSessionWrite: boolean;
  hasTokenEndpointFetch: boolean;
  hasResourceFetch: boolean;
  hasBearerFetch: boolean;
  hasAccessTokenSessionWrite: boolean;
  hasExpiryCheck: boolean;
  hasAudienceCheck: boolean;
  hasIssuerCheck: boolean;
  hasTokenPresenceGuard: boolean;
};

const ADVANCE_EXPIRY_MS = 610_000;
const REQUEST_AT_INCREMENT_MS = 10;
const REPLAY_AT_INCREMENT_MS = 10;

function toDefaultRoutePath(entrypoint: ActionSpaceEntrypoint): string {
  return entrypoint.routePath ?? "/auth/callback";
}

function toRequestUrl(routePath: string, params: Record<string, string>): string {
  const url = new URL(`https://app.test${routePath}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function collectCallbackIoSignals(
  entrypointId: string,
  externalIo: ActionSpaceExternalIo[],
): CallbackIoSignals {
  const signals: CallbackIoSignals = {};

  for (const io of externalIo) {
    // callback エントリポイントの fetch だけをシナリオ生成のヒントとして扱う。
    if (io.entrypointId !== entrypointId || io.ioType !== "fetch") {
      continue;
    }

    const destination =
      typeof io.detail.destination === "string" ? io.detail.destination : undefined;

    // token endpoint が見つかった場合、token 系異常系シナリオの stub 先として採用する。
    if (io.detail.tokenEndpoint === true && destination) {
      signals.tokenEndpoint = destination;
      continue;
    }

    // resource endpoint が見つかった場合、resource fetch 異常系シナリオに利用する。
    if (io.detail.resourceApi === true && destination) {
      signals.resourceEndpoint = destination;
    }
  }

  return signals;
}

function includesAnyKeyword(text: string | undefined, keywords: string[]): boolean {
  // 判定対象テキストが無い場合はキーワード一致を評価できないため false を返す。
  if (!text) {
    return false;
  }

  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function toEntrypointAnalysisSignals(
  entrypointId: string,
  guards: ActionSpaceGuard[],
  externalIo: ActionSpaceExternalIo[],
): EntrypointAnalysisSignals {
  const entrypointGuards = guards.filter((guard) => guard.entrypointId === entrypointId);
  const entrypointIo = externalIo.filter((io) => io.entrypointId === entrypointId);
  const stateComparisonGuard = entrypointGuards.some(
    (guard) =>
      guard.tags.includes("mismatch_validation") &&
      includesAnyKeyword(guard.condition, ["state"]),
  );
  const stateSessionReadIo = entrypointIo.some(
    (io) =>
      io.ioType === "session_read" &&
      includesAnyKeyword(
        typeof io.detail.key === "string" ? io.detail.key : undefined,
        ["state"],
      ),
  );
  const verifierSessionReadIo = entrypointIo.some(
    (io) =>
      io.ioType === "session_read" &&
      includesAnyKeyword(
        typeof io.detail.key === "string" ? io.detail.key : undefined,
        ["verifier", "code_verifier"],
      ),
  );
  const verifierSessionWriteIo = entrypointIo.some(
    (io) =>
      io.ioType === "session_write" &&
      includesAnyKeyword(
        typeof io.detail.key === "string" ? io.detail.key : undefined,
        ["verifier", "code_verifier"],
      ),
  );
  const tokenEndpointFetchIo = entrypointIo.some(
    (io) => io.ioType === "fetch" && io.detail.tokenEndpoint === true,
  );
  const resourceFetchIo = entrypointIo.some(
    (io) => io.ioType === "fetch" && io.detail.resourceApi === true,
  );
  const bearerFetchIo = entrypointIo.some(
    (io) => io.ioType === "fetch" && io.detail.hasBearer === true,
  );
  const accessTokenSessionWriteIo = entrypointIo.some(
    (io) =>
      io.ioType === "session_write" &&
      includesAnyKeyword(
        typeof io.detail.key === "string" ? io.detail.key : undefined,
        ["access_token", "accesstoken", "token"],
      ),
  );
  const expiryGuard = entrypointGuards.some((guard) =>
    includesAnyKeyword(guard.condition, ["exp", "expires", "expiry"]),
  );
  const audienceGuard = entrypointGuards.some((guard) =>
    includesAnyKeyword(guard.condition, ["aud", "audience"]),
  );
  const issuerGuard = entrypointGuards.some((guard) =>
    includesAnyKeyword(guard.condition, ["iss", "issuer"]),
  );
  const tokenPresenceGuard = entrypointGuards.some(
    (guard) =>
      guard.tags.includes("token_absent") ||
      includesAnyKeyword(guard.condition, ["accessToken", "refreshToken", "Bearer"]),
  );

  return {
    hasStateComparison: stateComparisonGuard,
    hasStateSessionRead: stateSessionReadIo,
    hasVerifierSessionRead: verifierSessionReadIo,
    hasVerifierSessionWrite: verifierSessionWriteIo,
    hasTokenEndpointFetch: tokenEndpointFetchIo,
    hasResourceFetch: resourceFetchIo,
    hasBearerFetch: bearerFetchIo,
    hasAccessTokenSessionWrite: accessTokenSessionWriteIo,
    hasExpiryCheck: expiryGuard,
    hasAudienceCheck: audienceGuard,
    hasIssuerCheck: issuerGuard,
    hasTokenPresenceGuard: tokenPresenceGuard,
  };
}

function buildInconclusiveFindingsForEntrypoint(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
  signals: EntrypointAnalysisSignals,
): AttackDslFinding[] {
  const findings: AttackDslFinding[] = [];

  // token exchange の痕跡はあるが verifier 連携の閉路は静的解析だけでは確定できない。
  if (signals.hasTokenEndpointFetch && signals.hasVerifierSessionRead) {
    findings.push({
      id: `${entrypoint.id}-pkce-flow-inconclusive`,
      entrypointId: entrypoint.id,
      routePath,
      category: "inconclusive",
      title: "PKCE verifier の token exchange 接続が解析不能",
      detail:
        "PKCE verifier の参照と token exchange 呼び出しは検出されましたが、同一リクエストへ接続されるデータフローを静的解析で確定できません。",
      recommendedAction: "manual_minimum_dsl_completion",
    });
  }

  // Bearer 検証っぽいガードがあっても aud/iss/exp の網羅性は別軸で確認が必要。
  if (
    (signals.hasBearerFetch || signals.hasTokenPresenceGuard) &&
    (!signals.hasAudienceCheck || !signals.hasIssuerCheck || !signals.hasExpiryCheck)
  ) {
    findings.push({
      id: `${entrypoint.id}-bearer-claims-inconclusive`,
      entrypointId: entrypoint.id,
      routePath,
      category: "inconclusive",
      title: "Bearer 検証の aud/iss/exp 網羅が解析不能",
      detail:
        "Bearer token 取り扱いの痕跡は検出されましたが、audience / issuer / expiry の全検証が同一路線で実装されているか静的解析では確定できません。",
      recommendedAction: "add_annotations",
    });
  }

  return findings;
}

function buildMissingOrSuspectFindingsForCallbackEntrypoint(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
  signals: EntrypointAnalysisSignals,
): AttackDslFinding[] {
  const findings: AttackDslFinding[] = [];

  // callback で state 比較が見えない場合は CSRF 防御欠落の疑いが高い。
  if (!signals.hasStateComparison) {
    findings.push({
      id: `${entrypoint.id}-state-compare-missing`,
      entrypointId: entrypoint.id,
      routePath,
      category: "missing_or_suspect",
      title: "callback に state 比較が見当たりません",
      detail:
        "callback エンドポイントは検出されましたが、query state と session state を比較するガードが確認できません。",
      recommendedAction: "fix_implementation_gap",
    });
  }

  // verifier を保存しているのに callback 側で読まない場合は PKCE 不備の疑いが高い。
  if (signals.hasVerifierSessionWrite && !signals.hasVerifierSessionRead) {
    findings.push({
      id: `${entrypoint.id}-verifier-read-missing`,
      entrypointId: entrypoint.id,
      routePath,
      category: "missing_or_suspect",
      title: "PKCE verifier 保存後の参照が見当たりません",
      detail:
        "session への verifier 保存は検出されましたが、callback で verifier を参照する処理が確認できません。",
      recommendedAction: "fix_implementation_gap",
    });
  }

  // token exchange があるのに verifier 参照が無い場合は PKCE バインディング不足が疑われる。
  if (signals.hasTokenEndpointFetch && !signals.hasVerifierSessionRead) {
    findings.push({
      id: `${entrypoint.id}-token-exchange-without-verifier`,
      entrypointId: entrypoint.id,
      routePath,
      category: "missing_or_suspect",
      title: "token exchange に対する verifier 参照が見当たりません",
      detail:
        "token exchange への HTTP 呼び出しは検出されましたが、code_verifier の読み出しや検証経路が確認できません。",
      recommendedAction: "fix_implementation_gap",
    });
  }

  // access token を保存しているのに exp 系ガードが無い場合は有効期限検証漏れの疑いがある。
  if (signals.hasAccessTokenSessionWrite && !signals.hasExpiryCheck) {
    findings.push({
      id: `${entrypoint.id}-token-expiry-check-missing`,
      entrypointId: entrypoint.id,
      routePath,
      category: "missing_or_suspect",
      title: "access token の exp 検証が見当たりません",
      detail:
        "access token の受領・保存は検出されましたが、exp / expires の検証ガードが確認できません。",
      recommendedAction: "fix_implementation_gap",
    });
  }

  // state 読み取り自体が無い場合は framework 抽象化の影響を疑うため規約寄り修正を推奨する。
  if (!signals.hasStateSessionRead) {
    findings.push({
      id: `${entrypoint.id}-state-read-weak`,
      entrypointId: entrypoint.id,
      routePath,
      category: "missing_or_suspect",
      title: "state 読み取りの根拠が弱く callback 保護が不明瞭です",
      detail:
        "session から state を読む操作が検出されず、検証ロジックがフレームワーク規約外に隠れている可能性があります。",
      recommendedAction: "rewrite_to_framework_convention",
    });
  }

  return findings;
}

function buildBaseSession(overrides?: Record<string, string>): Record<string, string> {
  return {
    "oauth:state": "expected-state",
    "oauth:verifier": "expected-verifier",
    ...(overrides ?? {}),
  };
}

function withScenarioMetadata(
  entrypointId: string,
  operations: Array<
    Omit<Extract<AttackDslOperation, { type: "request" }>, "at" | "expect" | "derivedFrom">
    | Omit<Extract<AttackDslOperation, { type: "advance_time" }>, "at" | "expect" | "derivedFrom">
    | Omit<Extract<AttackDslOperation, { type: "replay" }>, "at" | "expect" | "derivedFrom">
  >,
  expectedPolicyIds: string[],
): AttackDslOperation[] {
  const normalized: AttackDslOperation[] = [];
  let currentAt = 0;

  for (const operation of operations) {
    // 各 operation は entrypoint 由来情報を持たせ、UI と静的解析の接続点を明示する。
    if (operation.type === "request") {
      normalized.push({
        ...operation,
        at: currentAt,
        expect: [],
        derivedFrom: {
          entrypointId,
        },
      });
      currentAt += REQUEST_AT_INCREMENT_MS;
      continue;
    }

    // advance_time は時刻を進める操作そのものなので、終了時刻へ累積時刻を更新する。
    if (operation.type === "advance_time") {
      normalized.push({
        ...operation,
        at: currentAt,
        expect: [],
        derivedFrom: {
          entrypointId,
        },
      });
      currentAt += operation.ms;
      continue;
    }

    // 最終 replay は期待ポリシーが成立する観測点なので operation 単位 expect を持たせる。
    normalized.push({
      ...operation,
      at: currentAt,
      expect: expectedPolicyIds,
      derivedFrom: {
        entrypointId,
      },
    });
    currentAt += REPLAY_AT_INCREMENT_MS;
  }

  // 単発 request シナリオでは request 自体が観測点なので scenario 期待を移譲する。
  if (normalized.length === 1 && normalized[0]?.type === "request") {
    normalized[0] = {
      ...normalized[0],
      expect: expectedPolicyIds,
    };
  }

  return normalized;
}

function buildMissingInputScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
): AttackDslScenario {
  const expectedPolicyIds = ["state_required"];

  return {
    id: `${entrypoint.id}-missing-input`,
    entrypointId: entrypoint.id,
    routePath,
    title: "query code/state 欠落",
    description: "code/state を未指定で callback を実行し、入力欠落ガードの挙動を検証する。",
    operations: withScenarioMetadata(entrypoint.id, [
      {
        type: "request",
        id: "missing-input",
        request: {
          url: toRequestUrl(routePath, {}),
          method: "GET",
        },
        session: buildBaseSession(),
        note: "code/state を送らない",
      },
    ], expectedPolicyIds),
    expectedPolicyIds,
  };
}

function buildTamperedStateScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
): AttackDslScenario {
  const expectedPolicyIds = ["state_matches_session"];

  return {
    id: `${entrypoint.id}-tampered-state`,
    entrypointId: entrypoint.id,
    routePath,
    title: "state 改ざん",
    description: "session 側 state と query state を不一致にして改ざん検知を確認する。",
    operations: withScenarioMetadata(entrypoint.id, [
      {
        type: "request",
        id: "tampered-state",
        request: {
          url: toRequestUrl(routePath, {
            code: "code-a",
            state: "tampered-state",
          }),
          method: "GET",
        },
        session: buildBaseSession({
          "oauth:state": "original-state",
        }),
        note: "query.state と session state を意図的に不一致にする",
      },
    ], expectedPolicyIds),
    expectedPolicyIds,
  };
}

function buildMissingSessionScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
): AttackDslScenario {
  const expectedPolicyIds = ["session_required"];

  return {
    id: `${entrypoint.id}-missing-session`,
    entrypointId: entrypoint.id,
    routePath,
    title: "session 欠落",
    description: "query は正しく与えつつ session を空にして処理継続可否を検証する。",
    operations: withScenarioMetadata(entrypoint.id, [
      {
        type: "request",
        id: "missing-session",
        request: {
          url: toRequestUrl(routePath, {
            code: "code-a",
            state: "expected-state",
          }),
          method: "GET",
        },
        session: {},
        note: "cookie/session を空で実行する",
      },
    ], expectedPolicyIds),
    expectedPolicyIds,
  };
}

function buildTokenFailureScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
  tokenEndpoint: string,
): AttackDslScenario {
  const expectedPolicyIds = ["token_failure_safe_redirect"];

  return {
    id: `${entrypoint.id}-token-endpoint-failure`,
    entrypointId: entrypoint.id,
    routePath,
    title: "token endpoint 異常",
    description: "token 交換 endpoint を 500 応答にスタブし、安全側遷移を確認する。",
    operations: withScenarioMetadata(entrypoint.id, [
      {
        type: "request",
        id: "token-endpoint-failure",
        request: {
          url: toRequestUrl(routePath, {
            code: "code-a",
            state: "expected-state",
          }),
          method: "GET",
        },
        session: buildBaseSession(),
        fetchStubs: [
          {
            matcher: tokenEndpoint,
            response: {
              status: 500,
              body: "token endpoint error",
            },
          },
        ],
        note: "token endpoint を 500 に固定する",
      },
    ], expectedPolicyIds),
    expectedPolicyIds,
  };
}

function buildTokenExtremeExpiryScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
  tokenEndpoint: string,
): AttackDslScenario {
  const expectedPolicyIds = ["token_expiry_reasonable"];

  return {
    id: `${entrypoint.id}-token-extreme-expiry`,
    entrypointId: entrypoint.id,
    routePath,
    title: "expires_in 極端値",
    description: "token 応答の expires_in を極端値にし、保存時の検証有無を確認する。",
    operations: withScenarioMetadata(entrypoint.id, [
      {
        type: "request",
        id: "token-extreme-expiry",
        request: {
          url: toRequestUrl(routePath, {
            code: "code-a",
            state: "expected-state",
          }),
          method: "GET",
        },
        session: buildBaseSession(),
        fetchStubs: [
          {
            matcher: tokenEndpoint,
            response: {
              status: 200,
              body: JSON.stringify({
                access_token: "attack-token",
                expires_in: 2_147_483_647,
              }),
              headers: {
                "Content-Type": "application/json",
              },
            },
          },
        ],
        note: "expires_in に 32bit 上限値を与える",
      },
    ], expectedPolicyIds),
    expectedPolicyIds,
  };
}

function buildResourceFailureScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
  resourceEndpoint: string,
): AttackDslScenario {
  const expectedPolicyIds = ["resource_failure_safe_redirect"];

  return {
    id: `${entrypoint.id}-resource-endpoint-failure`,
    entrypointId: entrypoint.id,
    routePath,
    title: "resource endpoint 異常",
    description: "user/resource endpoint を 503 応答にスタブしてエラー分岐を検証する。",
    operations: withScenarioMetadata(entrypoint.id, [
      {
        type: "request",
        id: "resource-endpoint-failure",
        request: {
          url: toRequestUrl(routePath, {
            code: "code-a",
            state: "expected-state",
          }),
          method: "GET",
        },
        session: buildBaseSession(),
        fetchStubs: [
          {
            matcher: resourceEndpoint,
            response: {
              status: 503,
              body: "resource endpoint error",
            },
          },
        ],
        note: "resource endpoint の異常系を固定する",
      },
    ], expectedPolicyIds),
    expectedPolicyIds,
  };
}

function buildReplayScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
): AttackDslScenario {
  const expectedPolicyIds = ["replay_rejected"];

  return {
    id: `${entrypoint.id}-replay`,
    entrypointId: entrypoint.id,
    routePath,
    title: "同一 code リプレイ",
    description: "同じ callback request を replay し、再利用拒否の有無を確認する。",
    operations: withScenarioMetadata(entrypoint.id, [
      {
        type: "request",
        id: "initial-callback",
        request: {
          url: toRequestUrl(routePath, {
            code: "replay-code",
            state: "expected-state",
          }),
          method: "GET",
        },
        session: buildBaseSession(),
        note: "初回 callback を実行する",
      },
      {
        type: "replay",
        id: "replay-initial-callback",
        target: "initial-callback",
        note: "同じ request を再送する",
      },
    ], expectedPolicyIds),
    expectedPolicyIds,
  };
}

function buildAdvanceTimeScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
): AttackDslScenario {
  const expectedPolicyIds = ["session_expiry_enforced"];

  return {
    id: `${entrypoint.id}-expiry`,
    entrypointId: entrypoint.id,
    routePath,
    title: "AdvanceTime 期限超過",
    description: "時刻を進めて cookie/session の期限切れ後に replay し、無効化を確認する。",
    operations: withScenarioMetadata(entrypoint.id, [
      {
        type: "request",
        id: "before-expiry",
        request: {
          url: toRequestUrl(routePath, {
            code: "expiring-code",
            state: "expected-state",
          }),
          method: "GET",
        },
        session: buildBaseSession(),
        note: "有効期限前の callback を実行する",
      },
      {
        type: "advance_time",
        id: "advance-expiry-window",
        ms: ADVANCE_EXPIRY_MS,
        note: "session の有効期限を超える時間を進める",
      },
      {
        type: "replay",
        id: "replay-after-expiry",
        target: "before-expiry",
        note: "期限切れ後に同じ callback を再実行する",
      },
    ], expectedPolicyIds),
    expectedPolicyIds,
  };
}

function buildScenariosForCallbackEntrypoint(
  entrypoint: ActionSpaceEntrypoint,
  options: {
    externalIo: ActionSpaceExternalIo[];
  },
): AttackDslScenario[] {
  const routePath = toDefaultRoutePath(entrypoint);
  const scenarios: AttackDslScenario[] = [];
  const ioSignals = collectCallbackIoSignals(entrypoint.id, options.externalIo);

  scenarios.push(buildMissingInputScenario(entrypoint, routePath));
  scenarios.push(buildTamperedStateScenario(entrypoint, routePath));
  scenarios.push(buildMissingSessionScenario(entrypoint, routePath));

  // token endpoint が検出できる場合のみ、token stub 系シナリオを生成する。
  if (ioSignals.tokenEndpoint) {
    scenarios.push(
      buildTokenFailureScenario(entrypoint, routePath, ioSignals.tokenEndpoint),
    );
    scenarios.push(
      buildTokenExtremeExpiryScenario(entrypoint, routePath, ioSignals.tokenEndpoint),
    );
  }

  // resource endpoint が見える callback のみ、resource fetch 異常系を追加する。
  if (ioSignals.resourceEndpoint) {
    scenarios.push(
      buildResourceFailureScenario(entrypoint, routePath, ioSignals.resourceEndpoint),
    );
  }

  scenarios.push(buildReplayScenario(entrypoint, routePath));
  scenarios.push(buildAdvanceTimeScenario(entrypoint, routePath));

  return scenarios;
}

/**
 * 静的解析済み action-space から callback 攻撃シナリオ DSL を自動生成する。
 *
 * 入力例:
 * - { actionSpace: { version: 1, entrypoints: [{ id: "entrypoint-1", endpointKinds: ["callback"], routePath: "/auth/github/callback", ... }], externalIo: [{ entrypointId: "entrypoint-1", ioType: "fetch", detail: { destination: "https://github.com/login/oauth/access_token", tokenEndpoint: true } }], ... } }
 * 出力例:
 * - { version: 1, dslVersion: 2, summary: { callbackEntrypoints: 1, scenarios: 7 }, scenarios: [{ id: "entrypoint-1-missing-input", operations: [{ type: "request", at: 0, expect: ["state_required"], ... }] }, ...] }
 */
export function buildAttackDslReport(
  options: BuildAttackDslReportOptions,
): AttackDslReport {
  const callbackEntrypoints = options.actionSpace.entrypoints.filter((entrypoint) =>
    entrypoint.endpointKinds.includes("callback"),
  );
  const scenarios: AttackDslScenario[] = [];
  const inconclusive: AttackDslFinding[] = [];
  const missingOrSuspect: AttackDslFinding[] = [];

  for (const entrypoint of callbackEntrypoints) {
    const routePath = toDefaultRoutePath(entrypoint);
    const signals = toEntrypointAnalysisSignals(
      entrypoint.id,
      options.actionSpace.guards,
      options.actionSpace.externalIo,
    );

    scenarios.push(
      ...buildScenariosForCallbackEntrypoint(entrypoint, {
        externalIo: options.actionSpace.externalIo,
      }),
    );
    inconclusive.push(
      ...buildInconclusiveFindingsForEntrypoint(entrypoint, routePath, signals),
    );
    missingOrSuspect.push(
      ...buildMissingOrSuspectFindingsForCallbackEntrypoint(
        entrypoint,
        routePath,
        signals,
      ),
    );
  }

  return {
    version: 1,
    dslVersion: 2,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    summary: {
      callbackEntrypoints: callbackEntrypoints.length,
      scenarios: scenarios.length,
      generated: scenarios.length,
      inconclusive: inconclusive.length,
      missingOrSuspect: missingOrSuspect.length,
    },
    generated: scenarios,
    inconclusive,
    missingOrSuspect,
    scenarios,
  };
}
