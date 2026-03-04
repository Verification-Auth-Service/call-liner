import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { programToAstJson } from "./ast/program-to-ast-json";
import { writeEntryAstReports } from "./app/write-entry-ast-reports";
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

describe("writeEntryAstReports", () => {
  it("writes AST reports for absolute and relative entries while keeping directories", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-"));

    try {
      const absoluteEntry = path.join(tempRoot, "external", "auth-app", "app", "routes.ts");
      const relativeEntry = path.join("apps", "resource-server", "app", "routes.ts");

      await mkdir(path.dirname(absoluteEntry), { recursive: true });
      await writeFile(absoluteEntry, "export const authRoutes = [];", "utf8");

      const relativeSourcePath = path.join(tempRoot, relativeEntry);
      await mkdir(path.dirname(relativeSourcePath), { recursive: true });
      await writeFile(relativeSourcePath, "export const resourceRoutes = [];", "utf8");

      const outputDir = path.join(tempRoot, "report");
      await writeEntryAstReports({
        entries: [absoluteEntry, relativeEntry],
        outputDir,
        baseDir: tempRoot,
      });

      const absoluteReportPath = path.join(
        outputDir,
        `${path.relative(path.parse(absoluteEntry).root, absoluteEntry)}.json`,
      );
      const relativeReportPath = path.join(outputDir, `${relativeEntry}.json`);

      expect(existsSync(absoluteReportPath)).toBe(true);
      expect(existsSync(relativeReportPath)).toBe(true);

      const relativeAstRaw = await readFile(relativeReportPath, "utf8");
      const relativeAst = JSON.parse(relativeAstRaw) as { kind: string };
      expect(relativeAst.kind).toBe("SourceFile");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("throws when an entry file does not exist", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-"));

    try {
      await expect(
        writeEntryAstReports({
          entries: ["missing.ts"],
          outputDir: path.join(tempRoot, "report"),
          baseDir: tempRoot,
        }),
      ).rejects.toThrowError();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
