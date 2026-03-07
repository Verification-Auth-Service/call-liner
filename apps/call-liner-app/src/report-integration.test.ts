import { describe, expect, it } from "vitest";
import type { ActionSpaceReport, AttackDslReport } from "./domain-types";
import {
  buildScenarioTimelineViewModel,
  buildTimelineBoard,
  deriveTimelineFlows,
  findScenarioById,
  parseActionSpaceReportText,
  parseAttackDslReportText,
} from "./report-integration";
import { sampleActionSpaceReport, sampleAttackDslReport } from "./sample-reports";

describe("deriveTimelineFlows", () => {
  it("creates authorize + callback pairs", () => {
    const flows = deriveTimelineFlows(sampleActionSpaceReport);

    expect(flows).toEqual([
      {
        id: "flow-1",
        authorizeEntrypointId: "entrypoint-authorize-1",
        callbackEntrypointId: "entrypoint-callback-1",
        authorizePath: "/auth+/github+",
        callbackPath: "/auth+/github+/callback",
      },
    ]);
  });

  it("returns empty list when no route prefixes match", () => {
    const mismatched: ActionSpaceReport = {
      version: 1,
      generatedAt: "",
      entrypoints: [
        {
          id: "authorize-a",
          routePath: "/auth+/a",
          endpointKinds: ["authorize_start"],
        },
        {
          id: "callback-b",
          routePath: "/auth+/b+/callback",
          endpointKinds: ["callback"],
        },
      ],
    };

    expect(deriveTimelineFlows(mismatched)).toEqual([]);
  });
});

describe("findScenarioById", () => {
  it("returns scenario by id", () => {
    expect(findScenarioById(sampleAttackDslReport, "entrypoint-callback-1-replay").id).toBe(
      "entrypoint-callback-1-replay",
    );
  });

  it("throws when scenario does not exist", () => {
    expect(() => findScenarioById(sampleAttackDslReport, "missing")).toThrowError(
      /Scenario was not found/,
    );
  });
});

describe("buildTimelineBoard", () => {
  it("includes policy and flow clips", () => {
    const scenario = findScenarioById(sampleAttackDslReport, "entrypoint-callback-1-replay");
    const flow = deriveTimelineFlows(sampleActionSpaceReport)[0];
    const board = buildTimelineBoard(scenario, flow);

    expect(board.clips.some((clip) => clip.category === "policy")).toBe(true);
    expect(board.clips.some((clip) => clip.category === "flow")).toBe(true);
    expect(board.markers.length).toBeGreaterThan(0);
  });
});

describe("buildScenarioTimelineViewModel", () => {
  it("normalizes operations to fixed lane keys and inspector sections", () => {
    const scenario = findScenarioById(sampleAttackDslReport, "entrypoint-callback-2-expiry");
    const flow = deriveTimelineFlows(sampleActionSpaceReport).find((item) => {
      return item.callbackEntrypointId === scenario.entrypointId;
    });
    const viewModel = buildScenarioTimelineViewModel({
      scenario,
      flow,
      inconclusive: [],
      missingOrSuspect: [],
    });

    expect(viewModel.lanes.map((lane) => lane.key)).toEqual([
      "request",
      "advanceTime",
      "replay",
      "policyCheck",
      "flow",
    ]);
    expect(
      viewModel.segments.some((segment) => segment.laneKey === "advanceTime"),
    ).toBe(true);
    expect(viewModel.inspector.operations.some((item) => item.type === "replay")).toBe(
      true,
    );
  });

  it("omits flow summary and flow segments when matching flow does not exist", () => {
    const scenario = findScenarioById(sampleAttackDslReport, "entrypoint-callback-2-expiry");
    const viewModel = buildScenarioTimelineViewModel({
      scenario,
      flow: undefined,
      inconclusive: [],
      missingOrSuspect: [],
    });

    expect(viewModel.inspector.flowSummary).toBeUndefined();
    expect(viewModel.segments.some((segment) => segment.laneKey === "flow")).toBe(
      false,
    );
  });
});

describe("report parsers", () => {
  it("parses valid reports", () => {
    const parsedAttack = parseAttackDslReportText(
      JSON.stringify(sampleAttackDslReport),
    );
    const parsedAction = parseActionSpaceReportText(
      JSON.stringify(sampleActionSpaceReport),
    );

    expect(parsedAttack.scenarios.length).toBeGreaterThan(0);
    expect(parsedAttack.summary?.generated).toBe(parsedAttack.scenarios.length);
    expect(parsedAttack.generated?.length).toBe(parsedAttack.scenarios.length);
    expect(parsedAction.entrypoints.length).toBeGreaterThan(0);
  });

  it("throws for invalid report structures", () => {
    const invalidAttack: Partial<AttackDslReport> = {
      generatedAt: "",
      scenarios: [],
    };

    expect(() => parseAttackDslReportText(JSON.stringify(invalidAttack))).toThrowError(
      /Invalid attack-dsl report format/,
    );
    expect(() => parseActionSpaceReportText("{}"))
      .toThrowError(/Invalid action-space report format/);
  });
});
