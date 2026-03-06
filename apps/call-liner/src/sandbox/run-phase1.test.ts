import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPhase1Cli } from "./run-phase1";

describe("runPhase1Cli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs a route loader file by path and prints execution result as json", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-phase1-cli-"));

    try {
      const routeFilePath = path.join(tempRoot, "callback.tsx");
      const source = `
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { commitSession, getSession } from "~/services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const session = await getSession(request);
  if (!code || !state) return redirect("/error");
  if (state !== session.get("oauth:state")) return redirect("/error");
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", { method: "POST" });
  if (!tokenRes.ok) return redirect("/error");
  session.set("github:access_token", "token");
  const setCookie = await commitSession(session, { maxAge: 10 });
  return redirect("/githubinfo", { headers: { "Set-Cookie": setCookie } });
}
`;
      await writeFile(routeFilePath, source, "utf8");
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await runPhase1Cli([
        "--loader-file",
        routeFilePath,
        "--url",
        "https://app.test/auth/github/callback?code=ok&state=state-1",
        "--session",
        "oauth:state=state-1",
      ]);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const firstCallArg = logSpy.mock.calls[0]?.[0];
      const output = JSON.parse(String(firstCallArg)) as {
        status: number;
        location: string;
        trace: Array<{ type: string }>;
      };

      expect(output.status).toBe(302);
      expect(output.location).toBe("/githubinfo");
      expect(output.trace.some((event) => event.type === "fetch")).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
