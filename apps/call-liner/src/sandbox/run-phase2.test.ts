import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPhase2Cli } from "./run-phase2";

describe("runPhase2Cli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs phase2 operations and prints step results as json", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-phase2-cli-"));

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

      await runPhase2Cli([
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

  it("throws when --advance-ms is not integer", async () => {
    await expect(
      runPhase2Cli(["--loader-file", "/tmp/callback.tsx", "--url", "https://app.test", "--advance-ms", "x"]),
    ).rejects.toThrow("Expected integer milliseconds for --advance-ms");
  });
});
