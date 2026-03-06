import { describe, expect, it } from "vitest";
import { createSandboxState } from "./runtime";
import { runSandbox } from "./executor";

describe("sandbox executor", () => {
  it("expires cookies after advance_time and stops sending them", async () => {
    const loader = async ({
      request,
    }: {
      request: Request;
    }): Promise<Response> => {
      const step = new URL(request.url).searchParams.get("step");

      // cookie 発行フェーズでは 1 秒寿命のセッション cookie を返す。
      if (step === "set") {
        return new Response("issued", {
          status: 200,
          headers: {
            "Set-Cookie": "session=sandbox; Max-Age=1; Path=/",
          },
        });
      }

      return new Response(request.headers.get("cookie") ?? "", { status: 200 });
    };

    const state = createSandboxState({ nowMs: 1_700_000_000_000 });
    const result = await runSandbox({
      loader,
      state,
      operations: [
        {
          type: "request",
          id: "set-cookie",
          request: {
            url: "https://example.test/auth/callback?step=set",
          },
        },
        {
          type: "advance_time",
          ms: 1_000,
        },
        {
          type: "request",
          id: "read-cookie",
          request: {
            url: "https://example.test/auth/callback?step=read",
          },
        },
      ],
    });

    expect(result.nextState.cookieJar.session).toBeUndefined();
    expect(
      result.nextState.trace.some(
        (event) =>
          event.type === "time_advanced" && event.toMs === 1_700_000_001_000,
      ),
    ).toBe(true);
    expect(
      result.nextState.trace.some(
        (event) => event.type === "cookie_expired" && event.name === "session",
      ),
    ).toBe(true);

    const thirdStep = result.steps[2];
    // 3 ステップ目は request 実行なので必ず response が取得できる。
    if (!thirdStep || thirdStep.type !== "request") {
      throw new Error("Expected third step to be a request step");
    }
    expect(await thirdStep.response.text()).toBe("");
  });

  it("replays a previous request by id", async () => {
    const seenCodes = new Set<string>();
    const loader = async ({
      request,
    }: {
      request: Request;
    }): Promise<Response> => {
      const code = new URL(request.url).searchParams.get("code") ?? "";

      // 同一 code の再送は replay 攻撃として拒否する。
      if (seenCodes.has(code)) {
        return new Response("replay", { status: 409 });
      }

      seenCodes.add(code);
      return new Response("ok", { status: 200 });
    };

    const state = createSandboxState({ nowMs: 1_700_000_000_000 });
    const result = await runSandbox({
      loader,
      state,
      operations: [
        {
          type: "request",
          id: "callback-code-a",
          request: {
            url: "https://example.test/auth/callback?code=code-a&state=s-1",
          },
        },
        {
          type: "replay",
          target: "callback-code-a",
        },
      ],
    });

    const firstStep = result.steps[0];
    // 1 ステップ目は request で実行しているため response が存在する。
    if (!firstStep || firstStep.type !== "request") {
      throw new Error("Expected first step to be a request step");
    }

    const secondStep = result.steps[1];
    // 2 ステップ目は replay 実行なので replay 結果の response を検証する。
    if (!secondStep || secondStep.type !== "replay") {
      throw new Error("Expected second step to be a replay step");
    }

    expect(firstStep.response.status).toBe(200);
    expect(secondStep.response.status).toBe(409);
    expect(
      result.nextState.trace.some(
        (event) =>
          event.type === "replay" &&
          event.target === "callback-code-a" &&
          event.url.includes("code=code-a"),
      ),
    ).toBe(true);
  });

  it("throws when replay target does not exist", async () => {
    const loader = async (): Promise<Response> => {
      return new Response("ok", { status: 200 });
    };
    const state = createSandboxState({ nowMs: 1_700_000_000_000 });

    await expect(
      runSandbox({
        loader,
        state,
        operations: [
          {
            type: "replay",
            target: "missing-target",
          },
        ],
      }),
    ).rejects.toThrow("Replay target request id was not found");
  });

  it("throws when advance_time receives both ms and atMs", async () => {
    const loader = async (): Promise<Response> => {
      return new Response("ok", { status: 200 });
    };
    const state = createSandboxState({ nowMs: 1_700_000_000_000 });

    await expect(
      runSandbox({
        loader,
        state,
        operations: [
          {
            type: "advance_time",
            ms: 1_000,
            atMs: 1_700_000_100_000,
          },
        ],
      }),
    ).rejects.toThrow("advance_time requires either ms or atMs");
  });
});
