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
  scenarios: AttackDslScenario[];
};

export type TimelineClip = {
  id: string;
  laneId: string;
  label: string;
  startMs: number;
  endMs: number;
  tone: "red" | "green" | "amber";
  phase: "phase1" | "phase2" | "phase3" | "phase4";
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

export type Phase4Flow = {
  id: string;
  authorizeEntrypointId: string;
  callbackEntrypointId: string;
  authorizePath: string;
  callbackPath: string;
};
