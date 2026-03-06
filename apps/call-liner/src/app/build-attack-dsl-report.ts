import type {
  ActionSpaceEntrypoint,
  ActionSpaceExternalIo,
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
      type: "request";
      id: string;
      request: {
        url: string;
        method: "GET" | "POST";
      };
      session: Record<string, string>;
      fetchStubs?: AttackDslFetchStub[];
      note: string;
    }
  | {
      type: "advance_time";
      ms: number;
      note: string;
    }
  | {
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

export type AttackDslReport = {
  version: 1;
  generatedAt: string;
  summary: {
    callbackEntrypoints: number;
    scenarios: number;
  };
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

const ADVANCE_EXPIRY_MS = 610_000;

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

function buildBaseSession(overrides?: Record<string, string>): Record<string, string> {
  return {
    "oauth:state": "expected-state",
    "oauth:verifier": "expected-verifier",
    ...(overrides ?? {}),
  };
}

function buildMissingInputScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
): AttackDslScenario {
  return {
    id: `${entrypoint.id}-missing-input`,
    entrypointId: entrypoint.id,
    routePath,
    title: "query code/state 欠落",
    description: "code/state を未指定で callback を実行し、入力欠落ガードの挙動を検証する。",
    operations: [
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
    ],
    expectedPolicyIds: ["state_required"],
  };
}

function buildTamperedStateScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
): AttackDslScenario {
  return {
    id: `${entrypoint.id}-tampered-state`,
    entrypointId: entrypoint.id,
    routePath,
    title: "state 改ざん",
    description: "session 側 state と query state を不一致にして改ざん検知を確認する。",
    operations: [
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
    ],
    expectedPolicyIds: ["state_matches_session"],
  };
}

function buildMissingSessionScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
): AttackDslScenario {
  return {
    id: `${entrypoint.id}-missing-session`,
    entrypointId: entrypoint.id,
    routePath,
    title: "session 欠落",
    description: "query は正しく与えつつ session を空にして処理継続可否を検証する。",
    operations: [
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
    ],
    expectedPolicyIds: ["session_required"],
  };
}

function buildTokenFailureScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
  tokenEndpoint: string,
): AttackDslScenario {
  return {
    id: `${entrypoint.id}-token-endpoint-failure`,
    entrypointId: entrypoint.id,
    routePath,
    title: "token endpoint 異常",
    description: "token 交換 endpoint を 500 応答にスタブし、安全側遷移を確認する。",
    operations: [
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
    ],
    expectedPolicyIds: ["token_failure_safe_redirect"],
  };
}

function buildTokenExtremeExpiryScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
  tokenEndpoint: string,
): AttackDslScenario {
  return {
    id: `${entrypoint.id}-token-extreme-expiry`,
    entrypointId: entrypoint.id,
    routePath,
    title: "expires_in 極端値",
    description: "token 応答の expires_in を極端値にし、保存時の検証有無を確認する。",
    operations: [
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
    ],
    expectedPolicyIds: ["token_expiry_reasonable"],
  };
}

function buildResourceFailureScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
  resourceEndpoint: string,
): AttackDslScenario {
  return {
    id: `${entrypoint.id}-resource-endpoint-failure`,
    entrypointId: entrypoint.id,
    routePath,
    title: "resource endpoint 異常",
    description: "user/resource endpoint を 503 応答にスタブしてエラー分岐を検証する。",
    operations: [
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
    ],
    expectedPolicyIds: ["resource_failure_safe_redirect"],
  };
}

function buildReplayScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
): AttackDslScenario {
  return {
    id: `${entrypoint.id}-replay`,
    entrypointId: entrypoint.id,
    routePath,
    title: "同一 code リプレイ",
    description: "同じ callback request を replay し、再利用拒否の有無を確認する。",
    operations: [
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
        target: "initial-callback",
        note: "同じ request を再送する",
      },
    ],
    expectedPolicyIds: ["replay_rejected"],
  };
}

function buildAdvanceTimeScenario(
  entrypoint: ActionSpaceEntrypoint,
  routePath: string,
): AttackDslScenario {
  return {
    id: `${entrypoint.id}-expiry`,
    entrypointId: entrypoint.id,
    routePath,
    title: "AdvanceTime 期限超過",
    description: "時刻を進めて cookie/session の期限切れ後に replay し、無効化を確認する。",
    operations: [
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
        ms: ADVANCE_EXPIRY_MS,
        note: "session の有効期限を超える時間を進める",
      },
      {
        type: "replay",
        target: "before-expiry",
        note: "期限切れ後に同じ callback を再実行する",
      },
    ],
    expectedPolicyIds: ["session_expiry_enforced"],
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
 * - { version: 1, summary: { callbackEntrypoints: 1, scenarios: 7 }, scenarios: [{ id: "entrypoint-1-missing-input", operations: [{ type: "request", ... }] }, ...] }
 */
export function buildAttackDslReport(
  options: BuildAttackDslReportOptions,
): AttackDslReport {
  const callbackEntrypoints = options.actionSpace.entrypoints.filter((entrypoint) =>
    entrypoint.endpointKinds.includes("callback"),
  );
  const scenarios: AttackDslScenario[] = [];

  for (const entrypoint of callbackEntrypoints) {
    scenarios.push(
      ...buildScenariosForCallbackEntrypoint(entrypoint, {
        externalIo: options.actionSpace.externalIo,
      }),
    );
  }

  return {
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    summary: {
      callbackEntrypoints: callbackEntrypoints.length,
      scenarios: scenarios.length,
    },
    scenarios,
  };
}
