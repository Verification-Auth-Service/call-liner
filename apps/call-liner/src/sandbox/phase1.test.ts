import { describe, expect, it } from "vitest";
import {
  createPhase1SandboxState,
  runLoaderInPhase1Sandbox,
} from "./phase1";

describe("phase1 sandbox", () => {
  it("calls loader directly and forwards Set-Cookie to the next request", async () => {
    const loader = async ({ request }: { request: Request }): Promise<Response> => {
      const url = new URL(request.url);
      const step = url.searchParams.get("step");

      // 初回リクエストでは cookie を発行する。
      if (step === "set") {
        return new Response("issued", {
          status: 200,
          headers: {
            "Set-Cookie": "session=abc; Max-Age=60; Path=/",
          },
        });
      }

      return new Response(request.headers.get("cookie") ?? "", { status: 200 });
    };

    const state = createPhase1SandboxState({ nowMs: 1_700_000_000_000 });

    const first = await runLoaderInPhase1Sandbox({
      loader,
      state,
      request: {
        url: "https://example.test/auth/callback?step=set",
      },
    });
    const second = await runLoaderInPhase1Sandbox({
      loader,
      state: first.nextState,
      request: {
        url: "https://example.test/auth/callback?step=read",
      },
    });

    expect(await first.response.text()).toBe("issued");
    expect(await second.response.text()).toContain("session=abc");
    expect(second.nextState.cookieJar.session?.value).toBe("abc");
    expect(second.nextState.trace.some((event) => event.type === "cookie_set")).toBe(
      true,
    );
  });

  it("uses fetch stubs and records fetch trace", async () => {
    const loader = async (): Promise<Response> => {
      const tokenResponse = await fetch("https://example.test/token", {
        method: "POST",
      });
      return new Response(String(tokenResponse.status), { status: 200 });
    };
    const state = createPhase1SandboxState({ nowMs: 1_700_000_000_000 });

    const result = await runLoaderInPhase1Sandbox({
      loader,
      state,
      request: {
        url: "https://example.test/auth/callback",
      },
      fetchStubs: [
        {
          matcher: "https://example.test/token",
          response: new Response("ok", { status: 201 }),
        },
      ],
    });

    expect(await result.response.text()).toBe("201");
    expect(
      result.nextState.trace.some(
        (event) =>
          event.type === "fetch" &&
          event.url === "https://example.test/token" &&
          event.method === "POST",
      ),
    ).toBe(true);
  });

  it("throws when fetch is called without a matching stub", async () => {
    const loader = async (): Promise<Response> => {
      await fetch("https://example.test/token");
      return new Response("unreachable", { status: 200 });
    };
    const state = createPhase1SandboxState({ nowMs: 1_700_000_000_000 });

    await expect(
      runLoaderInPhase1Sandbox({
        loader,
        state,
        request: {
          url: "https://example.test/auth/callback",
        },
      }),
    ).rejects.toThrow("Fetch stub not found");
  });
});
