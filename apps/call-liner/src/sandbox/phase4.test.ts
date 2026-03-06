import { describe, expect, it } from "vitest";
import { createPhase1SandboxState } from "./phase1";
import { runPhase4Sandbox } from "./phase4";

describe("phase4 sandbox", () => {
  it("runs authorize and callback with matched state", async () => {
    const authorizeLoader = async (): Promise<Response> => {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "https://github.com/login/oauth/authorize?client_id=dummy&state=state-1",
        },
      });
    };
    const callbackLoader = async ({
      request,
    }: {
      request: Request;
    }): Promise<Response> => {
      const url = new URL(request.url);
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");

      // authorize 由来 state と callback code が揃ったときだけ成功とする。
      if (state === "state-1" && code === "sandbox-code") {
        return new Response("ok", { status: 200 });
      }

      return new Response("state-mismatch", { status: 409 });
    };

    const result = await runPhase4Sandbox({
      authorizeLoader,
      callbackLoader,
      state: createPhase1SandboxState({ nowMs: 1_700_000_000_000 }),
      authorizeRequest: {
        url: "https://app.test/auth/github",
      },
      callbackUrlBase: "https://app.test/auth/github/callback",
    });

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.type).toBe("authorize");
    expect(result.steps[0]?.response.status).toBe(302);
    expect(result.steps[1]?.type).toBe("callback");
    expect(result.steps[1]?.response.status).toBe(200);
    expect(result.callbackRequest.url).toContain("state=state-1");
    expect(result.callbackRequest.url).toContain("code=sandbox-code");
  });

  it("supports tampered state exploration", async () => {
    const authorizeLoader = async (): Promise<Response> => {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "https://github.com/login/oauth/authorize?state=state-1",
        },
      });
    };
    const callbackLoader = async ({
      request,
    }: {
      request: Request;
    }): Promise<Response> => {
      const state = new URL(request.url).searchParams.get("state");

      // 改ざん state を受け取ったケースを明確に識別できるよう 409 を返す。
      if (state !== "state-1") {
        return new Response("tampered", { status: 409 });
      }

      return new Response("ok", { status: 200 });
    };

    const result = await runPhase4Sandbox({
      authorizeLoader,
      callbackLoader,
      state: createPhase1SandboxState({ nowMs: 1_700_000_000_000 }),
      authorizeRequest: {
        url: "https://app.test/auth/github",
      },
      callbackUrlBase: "https://app.test/auth/github/callback",
      callbackStateStrategy: "tampered",
    });

    expect(result.steps[1]?.response.status).toBe(409);
    expect(result.callbackRequest.url).toContain("state=state-1-tampered");
  });

  it("throws when fixed state strategy has no explicit state", async () => {
    const authorizeLoader = async (): Promise<Response> => {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "https://github.com/login/oauth/authorize?state=state-1",
        },
      });
    };
    const callbackLoader = async (): Promise<Response> => {
      return new Response("ok", { status: 200 });
    };

    await expect(
      runPhase4Sandbox({
        authorizeLoader,
        callbackLoader,
        state: createPhase1SandboxState({ nowMs: 1_700_000_000_000 }),
        authorizeRequest: {
          url: "https://app.test/auth/github",
        },
        callbackUrlBase: "https://app.test/auth/github/callback",
        callbackStateStrategy: "fixed",
      }),
    ).rejects.toThrow("fixed state strategy requires fixedCallbackState");
  });
});
