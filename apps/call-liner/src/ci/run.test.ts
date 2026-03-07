import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCi } from "./run";

describe("runCi", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("runs analyze and single tasks from config and writes summary artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-ci-"));

    try {
      const projectRoot = path.join(tempRoot, "apps", "auth-app");
      const clientEntry = path.join(projectRoot, "app", "root.tsx");
      const loaderFile = path.join(projectRoot, "app", "routes", "api.resource.tsx");
      const configPath = path.join(tempRoot, "call-liner.ci.json");

      await mkdir(path.dirname(clientEntry), { recursive: true });
      await mkdir(path.dirname(loaderFile), { recursive: true });
      await writeFile(clientEntry, "export const root = null;", "utf8");
      await writeFile(
        loaderFile,
        `
import type { LoaderFunctionArgs } from "react-router";

export async function loader(_args: LoaderFunctionArgs) {
  return new Response("ok", { status: 200 });
}
`,
        "utf8",
      );
      await writeFile(
        configPath,
        JSON.stringify(
          {
            version: 1,
            projects: [
              {
                id: "auth-app",
                root: "apps/auth-app",
                tasks: [
                  {
                    id: "parse",
                    kind: "analyze",
                    clientEntry: "app/root.tsx",
                  },
                  {
                    id: "resource-ok",
                    kind: "single",
                    loaderFile: "app/routes/api.resource.tsx",
                    url: "https://app.test/api/resource",
                    expectStatus: 200,
                  },
                ],
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      await runCi(["--config", configPath]);

      const summaryRaw = await readFile(
        path.join(tempRoot, "artifacts", "call-liner", "summary.json"),
        "utf8",
      );
      const summary = JSON.parse(summaryRaw) as {
        status: string;
        counts: { pass: number; fail: number; error: number };
        results: Array<{ taskId: string; status: string }>;
      };

      expect(summary.status).toBe("pass");
      expect(summary.counts).toEqual({ pass: 2, fail: 0, error: 0 });
      expect(summary.results.map((result) => result.taskId)).toEqual([
        "parse",
        "resource-ok",
      ]);
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns fail exit code when a task violates expected status", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-ci-fail-"));

    try {
      const projectRoot = path.join(tempRoot, "apps", "auth-app");
      const loaderFile = path.join(projectRoot, "app", "routes", "api.resource.tsx");
      const configPath = path.join(tempRoot, "call-liner.ci.json");

      await mkdir(path.dirname(loaderFile), { recursive: true });
      await writeFile(
        loaderFile,
        `
import type { LoaderFunctionArgs } from "react-router";

export async function loader(_args: LoaderFunctionArgs) {
  return new Response("forbidden", { status: 403 });
}
`,
        "utf8",
      );
      await writeFile(
        configPath,
        JSON.stringify(
          {
            version: 1,
            projects: [
              {
                id: "auth-app",
                root: "apps/auth-app",
                tasks: [
                  {
                    id: "resource-mismatch",
                    kind: "single",
                    loaderFile: "app/routes/api.resource.tsx",
                    url: "https://app.test/api/resource",
                    expectStatus: 200,
                  },
                ],
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      await runCi(["--config", configPath]);

      const summaryRaw = await readFile(
        path.join(tempRoot, "artifacts", "call-liner", "summary.json"),
        "utf8",
      );
      const summary = JSON.parse(summaryRaw) as {
        status: string;
        counts: { pass: number; fail: number; error: number };
        results: Array<{ summary: string; status: string }>;
      };

      expect(summary.status).toBe("fail");
      expect(summary.counts).toEqual({ pass: 0, fail: 1, error: 0 });
      expect(summary.results[0]?.status).toBe("fail");
      expect(summary.results[0]?.summary).toContain("expected status 200");
      expect(process.exitCode).toBe(1);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
