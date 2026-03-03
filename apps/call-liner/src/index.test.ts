import { describe, expect, it } from "vitest";
import { programToAstJson } from "./ast/program-to-ast-json";
import { parseCliArgs } from "./cli/parse-cli-args";
import { formatCallLine } from "./format/format-call-line";

describe("parseCliArgs", () => {
  it("parses call-liner entry args", () => {
    expect(parseCliArgs(["-d", "--client-entry", "/tmp/client.tsx", "--resource-entry", "/tmp/resource.ts"])).toEqual({
      debug: true,
      clientEntry: "/tmp/client.tsx",
      resourceEntry: "/tmp/resource.ts",
    });
  });

  it("throws when required entries are missing", () => {
    expect(() => parseCliArgs(["-d"])).toThrowError("使い方:");
  });
});

describe("programToAstJson", () => {
  it("converts TypeScript code into tree-structured JSON", () => {
    const tree = programToAstJson("const x = 1;");
    expect(tree.kind).toBe("SourceFile");

    const statement = tree.children.find((node) => node.kind === "FirstStatement");
    expect(statement).toBeDefined();
    expect(statement?.children.some((node) => node.kind === "VariableDeclarationList")).toBe(true);
  });
});
