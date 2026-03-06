import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders timeline board and lane labels", () => {
    render(<App />);

    expect(screen.getByLabelText("timeline-board")).toBeInTheDocument();
    expect(screen.getByLabelText("OAuth Request")).toBeInTheDocument();
  });
});
