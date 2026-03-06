import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders integrated timeline verification screen", () => {
    render(<App />);

    expect(screen.getByText("Call Liner Timeline Lab")).toBeInTheDocument();
    expect(screen.getByLabelText("timeline-board")).toBeInTheDocument();
    expect(screen.getByLabelText("scenario-list")).toBeInTheDocument();
    expect(screen.getByLabelText("inspector")).toBeInTheDocument();
  });
});
