import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSandboxCli } from "./run-sandbox";

describe("runSandboxCli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs integrated operations and prints step results as json", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-sandbox-cli-"));

    try {
      const routeFilePath = path.join(tempRoot, "callback.tsx");
      const source = `
import type { LoaderFunctionArgs } from "react-router";

const seenCodes = new Set<string>();

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  if (seenCodes.has(code)) {
    return new Response("replay", { status: 409 });
  }
  seenCodes.add(code);
  return new Response("ok", { status: 200, headers: { "Set-Cookie": "session=abc; Max-Age=1; Path=/" } });
}
`;
      await writeFile(routeFilePath, source, "utf8");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await runSandboxCli([
        "--loader-file",
        routeFilePath,
        "--url",
        "https://app.test/auth/github/callback?code=ok&state=state-1",
        "--request-id",
        "callback",
        "--advance-ms",
        "1000",
        "--replay",
        "callback",
      ]);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const firstCallArg = logSpy.mock.calls[0]?.[0];
      const output = JSON.parse(String(firstCallArg)) as {
        steps: Array<{
          type: string;
          status?: number;
          target?: string | number;
        }>;
        trace: Array<{ type: string }>;
        cookieJar: Record<string, unknown>;
      };

      expect(output.steps[0]?.type).toBe("request");
      expect(output.steps[0]?.status).toBe(200);
      expect(output.steps[1]?.type).toBe("advance_time");
      expect(output.steps[2]?.type).toBe("replay");
      expect(output.steps[2]?.status).toBe(409);
      expect(output.steps[2]?.target).toBe("callback");
      expect(output.trace.some((event) => event.type === "time_advanced")).toBe(true);
      expect(output.trace.some((event) => event.type === "cookie_expired")).toBe(true);
      expect(output.trace.some((event) => event.type === "replay")).toBe(true);
      expect(output.cookieJar.session).toBeUndefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs oauth-two-step scenario and prints step results as json", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-sandbox-oauth-cli-"));

    try {
      const authorizeFilePath = path.join(tempRoot, "authorize.tsx");
      const callbackFilePath = path.join(tempRoot, "callback.tsx");
      const authorizeSource = `
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { commitSession, getSession } from "~/services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  session.set("oauth:state", "state-1");
  const setCookie = await commitSession(session, { maxAge: 60 });
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("state", "state-1");
  return redirect(authorizeUrl.toString(), { headers: { "Set-Cookie": setCookie } });
}
`;
      const callbackSource = `
import type { LoaderFunctionArgs } from "react-router";
import { getSession } from "~/services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request);
  const state = new URL(request.url).searchParams.get("state");
  if (state !== session.get("oauth:state")) {
    return new Response("mismatch", { status: 409 });
  }
  return new Response("ok", { status: 200 });
}
`;
      await writeFile(authorizeFilePath, authorizeSource, "utf8");
      await writeFile(callbackFilePath, callbackSource, "utf8");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await runSandboxCli([
        "--scenario",
        "oauth-two-step",
        "--authorize-loader-file",
        authorizeFilePath,
        "--callback-loader-file",
        callbackFilePath,
        "--authorize-url",
        "https://app.test/auth/github",
        "--callback-url-base",
        "https://app.test/auth/github/callback",
      ]);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const firstCallArg = logSpy.mock.calls[0]?.[0];
      const output = JSON.parse(String(firstCallArg)) as {
        steps: Array<{
          type: string;
          status: number;
          state: string | null;
        }>;
      };

      expect(output.steps).toHaveLength(2);
      expect(output.steps[0]?.type).toBe("authorize");
      expect(output.steps[0]?.status).toBe(302);
      expect(output.steps[0]?.state).toBe("state-1");
      expect(output.steps[1]?.type).toBe("callback");
      expect(output.steps[1]?.status).toBe(200);
      expect(output.steps[1]?.state).toBe("state-1");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("throws when fixed mode has no callback state in oauth-two-step scenario", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-sandbox-oauth-cli-"));

    try {
      const authorizeFilePath = path.join(tempRoot, "authorize.tsx");
      const callbackFilePath = path.join(tempRoot, "callback.tsx");
      await writeFile(
        authorizeFilePath,
        `
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export async function loader(_args: LoaderFunctionArgs) {
  return redirect("https://github.com/login/oauth/authorize?state=state-1");
}
`,
        "utf8",
      );
      await writeFile(
        callbackFilePath,
        `
import type { LoaderFunctionArgs } from "react-router";

export async function loader(_args: LoaderFunctionArgs) {
  return new Response("ok", { status: 200 });
}
`,
        "utf8",
      );

      await expect(
        runSandboxCli([
          "--scenario",
          "oauth-two-step",
          "--authorize-loader-file",
          authorizeFilePath,
          "--callback-loader-file",
          callbackFilePath,
          "--authorize-url",
          "https://app.test/auth/github",
          "--callback-url-base",
          "https://app.test/auth/github/callback",
          "--state-mode",
          "fixed",
        ]),
      ).rejects.toThrow("fixed state strategy requires fixedCallbackState");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("throws when --advance-ms is not integer", async () => {
    await expect(
      runSandboxCli([
        "--loader-file",
        "/tmp/callback.tsx",
        "--url",
        "https://app.test",
        "--advance-ms",
        "x",
      ]),
    ).rejects.toThrow("Expected integer milliseconds for --advance-ms");
  });
});
