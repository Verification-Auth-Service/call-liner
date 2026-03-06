import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { programToAstJson } from "../ast/program-to-ast-json";
import { buildActionSpaceReport } from "./build-action-space-report";

describe("buildActionSpaceReport", () => {
  it("extracts entrypoints, guards, and action space for authorize/callback/resource handlers", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-action-space-"));

    try {
      const authorizePath = path.join(
        tempRoot,
        "app",
        "routes",
        "auth+",
        "github+",
        "_index.tsx",
      );
      const callbackPath = path.join(
        tempRoot,
        "app",
        "routes",
        "auth+",
        "github+",
        "callback.tsx",
      );
      const resourcePath = path.join(
        tempRoot,
        "app",
        "routes",
        "githubinfo",
        "_index.tsx",
      );

      await mkdir(path.dirname(authorizePath), { recursive: true });
      await mkdir(path.dirname(callbackPath), { recursive: true });
      await mkdir(path.dirname(resourcePath), { recursive: true });

      const authorizeSource = `
import { redirect } from "react-router";
import { commitSession, getSession } from "~/services/session.server";
export async function loader({ request }: { request: Request }) {
  const session = await getSession(request);
  session.set("oauth:state", "state");
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  const setCookie = await commitSession(session, { maxAge: 60 * 10 });
  return redirect(authorizeUrl.toString(), { headers: { "Set-Cookie": setCookie } });
}
`;
      const callbackSource = `
import { redirect } from "react-router";
import { commitSession, getSession } from "~/services/session.server";
declare const prisma: any;
export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return redirect("/error");
  const session = await getSession(request);
  const savedState = session.get("oauth:state");
  if (state !== savedState) return redirect("/error");
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", { method: "POST" });
  const tokenJson = await tokenRes.json();
  const accessToken = tokenJson.access_token as string | undefined;
  if (!accessToken) return redirect("/error");
  await prisma.oAuthAccount.upsert({ where: { provider_providerAccountId: { provider: "github", providerAccountId: "1" } }, update: {}, create: { provider: "github", providerAccountId: "1" } });
  session.set("github:access_token", accessToken);
  const setCookie = await commitSession(session, { maxAge: 60 * 60 * 24 * 14 });
  return redirect("/githubinfo", { headers: { "Set-Cookie": setCookie } });
}
`;
      const resourceSource = `
import { getSession } from "~/services/session.server";
export async function loader({ request }: { request: Request }) {
  const session = await getSession(request);
  const accessToken = session.get("github:access_token");
  if (!accessToken || typeof accessToken !== "string") return new Response("missing", { status: 401 });
  const reposRes = await fetch("https://api.github.com/user/repos", {
    headers: {
      Authorization: \`Bearer \${accessToken}\`,
    },
  });
  return reposRes;
}
`;

      await writeFile(authorizePath, authorizeSource, "utf8");
      await writeFile(callbackPath, callbackSource, "utf8");
      await writeFile(resourcePath, resourceSource, "utf8");

      const report = await buildActionSpaceReport({
        reports: [
          {
            entryType: "client",
            sourcePath: authorizePath,
            reportRelativePath: "app/routes/auth+/github+/_index.tsx.json",
            astTree: programToAstJson(authorizeSource, authorizePath),
          },
          {
            entryType: "client",
            sourcePath: callbackPath,
            reportRelativePath: "app/routes/auth+/github+/callback.tsx.json",
            astTree: programToAstJson(callbackSource, callbackPath),
          },
          {
            entryType: "client",
            sourcePath: resourcePath,
            reportRelativePath: "app/routes/githubinfo/_index.tsx.json",
            astTree: programToAstJson(resourceSource, resourcePath),
          },
        ],
        routesByEntry: {
          client: [
            {
              sourcePath: authorizePath,
              routeId: "auth+/github+/_index",
              routePath: "/auth/github",
            },
            {
              sourcePath: callbackPath,
              routeId: "auth+/github+/callback",
              routePath: "/auth/github/callback",
            },
            {
              sourcePath: resourcePath,
              routeId: "githubinfo/_index",
              routePath: "/githubinfo",
            },
          ],
        },
      });

      const authorizeEntrypoint = report.entrypoints.find(
        (entrypoint) => entrypoint.routePath === "/auth/github",
      );
      const callbackEntrypoint = report.entrypoints.find(
        (entrypoint) => entrypoint.routePath === "/auth/github/callback",
      );
      const resourceEntrypoint = report.entrypoints.find(
        (entrypoint) => entrypoint.routePath === "/githubinfo",
      );

      expect(authorizeEntrypoint?.endpointKinds).toContain("authorize_start");
      expect(callbackEntrypoint?.endpointKinds).toContain("callback");
      expect(resourceEntrypoint?.endpointKinds).toContain("resource_access");
      expect(
        report.externalIo.some(
          (io) =>
            io.ioType === "fetch" &&
            io.detail.destination === "https://github.com/login/oauth/access_token",
        ),
      ).toBe(true);
      expect(
        report.externalIo.some(
          (io) => io.ioType === "db" && io.detail.operation === "upsert",
        ),
      ).toBe(true);
      expect(
        report.externalIo.some(
          (io) =>
            io.ioType === "session_write" && io.detail.key === "github:access_token",
        ),
      ).toBe(true);
      expect(
        report.externalIo.some(
          (io) => io.ioType === "cookie_commit" && io.detail.maxAge === "60 * 10",
        ),
      ).toBe(true);
      expect(
        report.guards.some((guard) => guard.tags.includes("mismatch_validation")),
      ).toBe(true);
      expect(
        report.actions.some((action) => action.type === "trigger_token_exchange"),
      ).toBe(true);
      expect(
        report.actions.some((action) => action.type === "guard_true"),
      ).toBe(true);
      expect(report.summary.entrypoints).toBe(3);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns an empty report when no exported loader/action exists", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-action-space-"));

    try {
      const sourcePath = path.join(tempRoot, "app", "routes", "_index.tsx");
      const sourceText = `export function component() { return null; }`;
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, sourceText, "utf8");

      const report = await buildActionSpaceReport({
        reports: [
          {
            entryType: "client",
            sourcePath,
            reportRelativePath: "app/routes/_index.tsx.json",
            astTree: programToAstJson(sourceText, sourcePath),
          },
        ],
        routesByEntry: {
          client: [
            {
              sourcePath,
              routeId: "_index",
              routePath: "/",
            },
          ],
        },
      });

      expect(report.summary.entrypoints).toBe(0);
      expect(report.guards).toEqual([]);
      expect(report.externalIo).toEqual([]);
      expect(report.actions).toEqual([]);
      expect(report.edges).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
