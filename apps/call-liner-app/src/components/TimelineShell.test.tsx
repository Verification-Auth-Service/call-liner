import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ScenarioTimelineViewModel } from "../domain-types";
import { TimelineShell } from "./TimelineShell";

function buildViewModel(): ScenarioTimelineViewModel {
  return {
    minTime: 0,
    maxTime: 1200,
    currentTime: 554,
    ticks: [],
    lanes: [
      { key: "request", label: "Request", description: "" },
      { key: "advanceTime", label: "Advance Time", description: "" },
      { key: "replay", label: "Replay", description: "" },
      { key: "state", label: "State", description: "" },
      { key: "policyCheck", label: "Policy Check", description: "" },
      { key: "flow", label: "Flow", description: "" },
    ],
    segments: [
      {
        id: "seg-state",
        laneKey: "state",
        startMs: 500,
        durationMs: 220,
        label: "session: valid",
        tone: "state",
        kind: "chip",
        stackIndex: 0,
      },
      {
        id: "seg-1",
        laneKey: "request",
        startMs: 500,
        durationMs: 200,
        label: "request:1",
        tone: "request",
        kind: "bar",
      },
    ],
    markers: [],
    inspector: {
      title: "t",
      description: "d",
      operations: [],
      expectedPolicies: [],
      inconclusive: [],
      missingOrSuspect: [],
    },
  };
}

describe("TimelineShell", () => {
  it("renders playhead and tick in the same time coordinate system", () => {
    const { container } = render(<TimelineShell viewModel={buildViewModel()} />);

    const tick = Array.from(container.querySelectorAll(".timelineHeaderTick")).find(
      (node) => node.textContent === "1000",
    );
    const playhead = container.querySelector(".timelinePlayhead") as HTMLElement;

    expect(tick).toBeTruthy();
    expect(tick).toHaveStyle({ left: "1000px" });
    expect(playhead).toHaveStyle({ left: "554px" });
    expect(container.querySelector(".timelineLaneLabels .timelinePlayhead")).toBeNull();
    expect(container.querySelector(".timelineScrollContent .timelinePlayhead")).toBeTruthy();
  });

  it("seeks from content coordinates after horizontal scroll", () => {
    const { container } = render(<TimelineShell viewModel={buildViewModel()} />);

    const viewport = container.querySelector(".timelineScrollViewport") as HTMLDivElement;
    const content = container.querySelector(".timelineScrollContent") as HTMLDivElement;

    Object.defineProperty(content, "getBoundingClientRect", {
      value: () => ({ left: 100, right: 1300, top: 0, bottom: 240, width: 1200, height: 240 }),
    });

    Object.defineProperty(viewport, "scrollLeft", {
      value: 300,
      writable: true,
    });

    fireEvent.scroll(viewport);
    fireEvent.pointerDown(content, { button: 0, clientX: 250 });

    expect(screen.getByText("150")).toBeInTheDocument();
  });

  it("updates current time while dragging playhead", () => {
    const { container } = render(<TimelineShell viewModel={buildViewModel()} />);

    const content = container.querySelector(".timelineScrollContent") as HTMLDivElement;
    const line = container.querySelector(".timelinePlayheadLine") as HTMLDivElement;

    Object.defineProperty(content, "getBoundingClientRect", {
      value: () => ({ left: 100, right: 1300, top: 0, bottom: 240, width: 1200, height: 240 }),
    });

    fireEvent.pointerDown(line, { button: 0, clientX: 654 });
    fireEvent.pointerMove(window, { clientX: 420 });
    fireEvent.pointerUp(window);

    expect(screen.getByText("320")).toBeInTheDocument();
  });

  it("renders the state lane chip labels", () => {
    render(<TimelineShell viewModel={buildViewModel()} />);

    expect(screen.getAllByText("State").length).toBeGreaterThan(0);
    expect(screen.getAllByText("session: valid").length).toBeGreaterThan(0);
  });
});
