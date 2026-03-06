import type { ActionSpaceReport, AttackDslReport } from "./domain-types";

export const sampleActionSpaceReport: ActionSpaceReport = {
  version: 1,
  generatedAt: "2026-03-06T02:26:16.546Z",
  entrypoints: [
    {
      id: "entrypoint-authorize-1",
      routePath: "/auth+/github+",
      endpointKinds: ["authorize_start"],
    },
    {
      id: "entrypoint-callback-1",
      routePath: "/auth+/github+/callback",
      endpointKinds: ["callback"],
    },
    {
      id: "entrypoint-callback-2",
      routePath: "/auth+/resource+/callback",
      endpointKinds: ["callback"],
    },
  ],
};

export const sampleAttackDslReport: AttackDslReport = {
  version: 1,
  generatedAt: "2026-03-06T02:26:16.546Z",
  scenarios: [
    {
      id: "entrypoint-callback-1-replay",
      entrypointId: "entrypoint-callback-1",
      routePath: "/auth+/github+/callback",
      title: "同一 code リプレイ",
      description: "初回 callback 後に replay を実行し、再利用拒否を確認する。",
      operations: [
        {
          type: "request",
          id: "initial-callback",
          request: {
            url: "https://app.test/auth+/github+/callback?code=replay-code&state=expected-state",
            method: "GET",
          },
          session: {
            "oauth:state": "expected-state",
            "oauth:verifier": "expected-verifier",
          },
          note: "初回 callback 実行",
        },
        {
          type: "replay",
          target: "initial-callback",
          note: "同じ request を再送",
        },
      ],
      expectedPolicyIds: ["replay_rejected"],
    },
    {
      id: "entrypoint-callback-2-expiry",
      entrypointId: "entrypoint-callback-2",
      routePath: "/auth+/resource+/callback",
      title: "AdvanceTime 期限超過",
      description: "期限超過後に replay して session 失効を検証する。",
      operations: [
        {
          type: "request",
          id: "before-expiry",
          request: {
            url: "https://app.test/auth+/resource+/callback?code=expiring-code&state=expected-state",
            method: "GET",
          },
          session: {
            "oauth:state": "expected-state",
            "oauth:verifier": "expected-verifier",
          },
          note: "期限前 callback 実行",
        },
        {
          type: "advance_time",
          ms: 610000,
          note: "有効期限を超えるまで進める",
        },
        {
          type: "replay",
          target: "before-expiry",
          note: "期限切れ後 replay",
        },
      ],
      expectedPolicyIds: ["session_expiry_enforced"],
    },
  ],
};
