export type ActionSpaceEntrypoint = {
  id: string;
  routePath?: string;
  endpointKinds: string[];
};

export type ActionSpaceReport = {
  version: 1;
  generatedAt: string;
  entrypoints: ActionSpaceEntrypoint[];
};

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
  dslVersion?: 2;
  generatedAt: string;
  summary?: {
    callbackEntrypoints: number;
    scenarios: number;
    generated: number;
    inconclusive: number;
    missingOrSuspect: number;
  };
  generated?: AttackDslScenario[];
  inconclusive?: AttackDslFinding[];
  missingOrSuspect?: AttackDslFinding[];
  scenarios: AttackDslScenario[];
};

export type TimelineClip = {
  id: string;
  laneId: string;
  label: string;
  startMs: number;
  endMs: number;
  tone: "red" | "green" | "amber";
  category: "operation" | "policy" | "flow";
};

export type TimelineMarker = {
  id: string;
  laneId: string;
  atMs: number;
};

export type TimelineLane = {
  id: string;
  label: string;
};

export type TimelineBoard = {
  maxMs: number;
  cursorMs: number;
  lanes: TimelineLane[];
  clips: TimelineClip[];
  markers: TimelineMarker[];
};

export type TimelineFlow = {
  id: string;
  authorizeEntrypointId: string;
  callbackEntrypointId: string;
  authorizePath: string;
  callbackPath: string;
};

export type TimelineLaneKey =
  | "request"
  | "advanceTime"
  | "replay"
  | "policyCheck"
  | "flow";

export type TimelineSegmentTone =
  | "request"
  | "advanceTime"
  | "replay"
  | "policy"
  | "flow";

export type TimelineSegmentKind = "bar" | "event";

export type TimelineLaneViewModel = {
  key: TimelineLaneKey;
  label: string;
  description: string;
};

export type TimelineSegmentViewModel = {
  id: string;
  laneKey: TimelineLaneKey;
  startMs: number;
  durationMs: number;
  label: string;
  tone: TimelineSegmentTone;
  kind: TimelineSegmentKind;
};

export type TimelineMarkerViewModel = {
  id: string;
  laneKey: TimelineLaneKey;
  atMs: number;
  label?: string;
};

export type TimelineTickViewModel = {
  timeMs: number;
  isMajor: boolean;
};

export type InspectorOperationItem = {
  id: string;
  type: AttackDslOperation["type"];
  at: number;
  detail: string;
  note: string;
  expect: string[];
};

export type ScenarioInspectorViewModel = {
  title: string;
  description: string;
  operations: InspectorOperationItem[];
  expectedPolicies: string[];
  flowSummary?: string;
  inconclusive: AttackDslFinding[];
  missingOrSuspect: AttackDslFinding[];
};

export type ScenarioTimelineViewModel = {
  minTime: number;
  maxTime: number;
  currentTime: number;
  ticks: TimelineTickViewModel[];
  lanes: TimelineLaneViewModel[];
  segments: TimelineSegmentViewModel[];
  markers: TimelineMarkerViewModel[];
  inspector: ScenarioInspectorViewModel;
};
