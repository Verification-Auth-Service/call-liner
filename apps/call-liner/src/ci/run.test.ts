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

  it("passes oauth-two-step database and refresh-token stub options from config", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-ci-oauth-"));

    try {
      const projectRoot = path.join(tempRoot, "apps", "auth-app");
      const authorizeFile = path.join(
        projectRoot,
        "app",
        "routes",
        "auth+",
        "github-app+",
        "_index.tsx",
      );
      const callbackFile = path.join(
        projectRoot,
        "app",
        "routes",
        "auth+",
        "github-app+",
        "callback.tsx",
      );
      const configPath = path.join(tempRoot, "call-liner.ci.json");

      await mkdir(path.dirname(authorizeFile), { recursive: true });
      await mkdir(path.dirname(callbackFile), { recursive: true });
      await writeFile(
        authorizeFile,
        `
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { commitSession, getSession } from "~/services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  session.set("oauth:state", "sandbox-state");
  session.set("oauth:verifier", "sandbox-verifier");
  session.set("oauth:createdAt", Date.now());
  const setCookie = await commitSession(session, { maxAge: 60 });
  return redirect("https://github.com/login/oauth/authorize?state=sandbox-state", {
    headers: {
      "Set-Cookie": setCookie,
    },
  });
}
`,
        "utf8",
      );
      await writeFile(
        callbackFile,
        `
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { commitSession, getSession } from "~/services/session.server";
import { prisma } from "@sample-auth-app/db";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const url = new URL(request.url);

  if (session.get("oauth:state") !== url.searchParams.get("state")) {
    // state 不一致時は reject 側分岐へ入ることを明示する。
    return new Response("invalid state", { status: 400 });
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
  });
  const tokenJson = await tokenRes.json();

  if (tokenJson.refresh_token !== "rotated-refresh-token") {
    // refresh token stub が未反映なら CI 設定の引き回し不備として失敗させる。
    return new Response("missing refresh token", { status: 500 });
  }

  await prisma.oAuthAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: "github_app",
        providerAccountId: "1",
      },
    },
    update: {
      refreshToken: tokenJson.refresh_token,
    },
    create: {
      refreshToken: tokenJson.refresh_token,
      user: { create: {} },
    },
  });

  session.set("github:refresh_token", String(tokenJson.refresh_token));
  const setCookie = await commitSession(session, { maxAge: 60 });
  return redirect("/githubinfo", {
    headers: {
      "Set-Cookie": setCookie,
    },
  });
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
                    id: "github-app-oauth",
                    kind: "oauth-two-step",
                    authorizeLoaderFile: "app/routes/auth+/github-app+/_index.tsx",
                    callbackLoaderFile: "app/routes/auth+/github-app+/callback.tsx",
                    authorizeUrl: "https://app.test/auth/github-app",
                    callbackUrlBase: "https://app.test/auth/github-app/callback",
                    specValidate: true,
                    stateExpiryMs: 60000000000,
                    stubRefreshToken: "rotated-refresh-token",
                    database: {
                      strategy: "memory-client",
                      global: "prisma",
                      models: ["user", "oAuthAccount"],
                    },
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
      const artifactRaw = await readFile(
        path.join(tempRoot, "artifacts", "call-liner", "auth-app", "github-app-oauth.json"),
        "utf8",
      );
      const summary = JSON.parse(summaryRaw) as {
        status: string;
        counts: { pass: number; fail: number; error: number };
      };
      const artifact = JSON.parse(artifactRaw) as {
        steps: Array<{
          type: string;
          status: number;
          location: string | null;
        }>;
      };

      expect(summary.status).toBe("pass");
      expect(summary.counts).toEqual({ pass: 1, fail: 0, error: 0 });
      expect(artifact.steps[1]?.type).toBe("callback");
      expect(artifact.steps[1]?.status).toBe(302);
      expect(artifact.steps[1]?.location).toBe("/githubinfo");
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("downgrades undefined helper references to warning-like pass results", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-ci-warning-"));

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
  return getLoggedInUser();
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
                    id: "resource-warning",
                    kind: "single",
                    loaderFile: "app/routes/api.resource.tsx",
                    url: "https://app.test/api/resource",
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
        results: Array<{
          status: string;
          summary: string;
          details?: { warning?: string; warningKind?: string };
        }>;
      };

      expect(summary.status).toBe("pass");
      expect(summary.counts).toEqual({ pass: 1, fail: 0, error: 0 });
      expect(summary.results[0]?.status).toBe("pass");
      expect(summary.results[0]?.summary).toBe("warning: getLoggedInUser is not defined");
      expect(summary.results[0]?.details).toEqual({
        warning: "getLoggedInUser is not defined",
        warningKind: "undefined_reference",
      });
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
