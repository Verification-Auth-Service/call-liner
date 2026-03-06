import { describe, expect, it } from "vitest";
import { buildAttackDslReport } from "./build-attack-dsl-report";
import type { ActionSpaceReport } from "./build-action-space-report";

function createBaseActionSpace(): ActionSpaceReport {
  return {
    version: 1,
    generatedAt: "2026-03-06T00:00:00.000Z",
    summary: {
      entrypoints: 1,
      guards: 0,
      externalIo: 0,
      actions: 0,
      edges: 0,
    },
    entrypoints: [
      {
        id: "entrypoint-1",
        entryType: "client",
        sourcePath: "/tmp/app/routes/auth+/github+/callback.tsx",
        routeId: "auth+/github+/callback",
        routePath: "/auth/github/callback",
        handlerName: "loader",
        endpointKinds: ["callback"],
      },
    ],
    guards: [],
    externalIo: [],
    actions: [],
    edges: [],
  };
}

describe("buildAttackDslReport", () => {
  it("generates callback attack scenarios from static action-space", () => {
    const actionSpace = createBaseActionSpace();
    actionSpace.externalIo = [
      {
        id: "io-token",
        entrypointId: "entrypoint-1",
        ioType: "fetch",
        line: 24,
        detail: {
          destination: "https://github.com/login/oauth/access_token",
          tokenEndpoint: true,
          resourceApi: false,
        },
      },
      {
        id: "io-user",
        entrypointId: "entrypoint-1",
        ioType: "fetch",
        line: 31,
        detail: {
          destination: "https://api.github.com/user",
          tokenEndpoint: false,
          resourceApi: true,
        },
      },
    ];

    const report = buildAttackDslReport({
      actionSpace,
      generatedAt: "2026-03-06T01:02:03.000Z",
    });

    expect(report.version).toBe(1);
    expect(report.generatedAt).toBe("2026-03-06T01:02:03.000Z");
    expect(report.summary.callbackEntrypoints).toBe(1);
    expect(report.summary.scenarios).toBe(8);
    expect(report.summary.generated).toBe(8);
    expect(report.summary.inconclusive).toBe(0);
    expect(report.summary.missingOrSuspect).toBe(3);
    expect(report.generated).toHaveLength(8);
    expect(report.inconclusive).toEqual([]);
    expect(report.missingOrSuspect.some((finding) => finding.id.endsWith("-state-compare-missing"))).toBe(
      true,
    );
    expect(
      report.missingOrSuspect.some((finding) =>
        finding.id.endsWith("-token-exchange-without-verifier"),
      ),
    ).toBe(true);
    expect(report.scenarios.some((scenario) => scenario.id.endsWith("-replay"))).toBe(
      true,
    );
    expect(report.scenarios.some((scenario) => scenario.id.endsWith("-expiry"))).toBe(
      true,
    );

    const tokenFailure = report.scenarios.find((scenario) =>
      scenario.id.endsWith("-token-endpoint-failure"),
    );

    // token endpoint が抽出された場合は fetch stub を含む異常系シナリオが必要。
    if (!tokenFailure) {
      throw new Error("Expected token endpoint failure scenario");
    }

    const firstOperation = tokenFailure.operations[0];

    // token endpoint シナリオの先頭は request operation である必要がある。
    if (!firstOperation || firstOperation.type !== "request") {
      throw new Error("Expected first operation to be a request");
    }

    expect(firstOperation.fetchStubs?.[0]?.matcher).toBe(
      "https://github.com/login/oauth/access_token",
    );
  });

  it("returns empty scenarios when callback entrypoints are absent", () => {
    const actionSpace = createBaseActionSpace();
    actionSpace.entrypoints = [
      {
        ...actionSpace.entrypoints[0],
        endpointKinds: ["resource_access"],
      },
    ];

    const report = buildAttackDslReport({
      actionSpace,
      generatedAt: "2026-03-06T01:02:03.000Z",
    });

    expect(report.summary.callbackEntrypoints).toBe(0);
    expect(report.summary.scenarios).toBe(0);
    expect(report.summary.generated).toBe(0);
    expect(report.summary.inconclusive).toBe(0);
    expect(report.summary.missingOrSuspect).toBe(0);
    expect(report.scenarios).toEqual([]);
    expect(report.generated).toEqual([]);
    expect(report.inconclusive).toEqual([]);
    expect(report.missingOrSuspect).toEqual([]);
  });

  it("skips token/resource stub scenarios when callback has no endpoint hints", () => {
    const actionSpace = createBaseActionSpace();

    const report = buildAttackDslReport({
      actionSpace,
      generatedAt: "2026-03-06T01:02:03.000Z",
    });

    expect(report.summary.callbackEntrypoints).toBe(1);
    expect(report.summary.scenarios).toBe(5);
    expect(report.summary.generated).toBe(5);
    expect(report.summary.inconclusive).toBe(0);
    expect(report.summary.missingOrSuspect).toBe(2);
    expect(
      report.scenarios.some((scenario) => scenario.id.endsWith("-token-endpoint-failure")),
    ).toBe(false);
    expect(
      report.scenarios.some((scenario) => scenario.id.endsWith("-resource-endpoint-failure")),
    ).toBe(false);
  });

  it("emits inconclusive findings when verifier read exists but data-flow closure is unknown", () => {
    const actionSpace = createBaseActionSpace();
    actionSpace.externalIo = [
      {
        id: "io-token",
        entrypointId: "entrypoint-1",
        ioType: "fetch",
        line: 21,
        detail: {
          destination: "https://github.com/login/oauth/access_token",
          tokenEndpoint: true,
          resourceApi: false,
        },
      },
      {
        id: "io-verifier-read",
        entrypointId: "entrypoint-1",
        ioType: "session_read",
        line: 12,
        detail: {
          method: "get",
          key: "oauth:verifier",
        },
      },
    ];

    const report = buildAttackDslReport({
      actionSpace,
      generatedAt: "2026-03-06T01:02:03.000Z",
    });

    expect(report.summary.inconclusive).toBe(1);
    expect(
      report.inconclusive.some((finding) =>
        finding.id.endsWith("-pkce-flow-inconclusive"),
      ),
    ).toBe(true);
  });
});
