import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRouteLoaderFromFile } from "./load-route-loader-from-file";

describe("loadRouteLoaderFromFile", () => {
  it("loads exported loader from tsx route module and executes with injected deps", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-loader-"));

    try {
      const routeFilePath = path.join(tempRoot, "callback.tsx");
      const source = `
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { commitSession, getSession } from "~/services/session.server";

function helper(url: URL) {
  return redirect(new URL("/error", url.origin).toString());
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state) return helper(url);
  const session = await getSession(request);
  if (state !== session.get("oauth:state")) return helper(url);
  session.set("done", true);
  const setCookie = await commitSession(session, { maxAge: 30 });
  return redirect("/ok", { headers: { "Set-Cookie": setCookie } });
}
`;
      await writeFile(routeFilePath, source, "utf8");

      const sessionMap = new Map<string, unknown>([["oauth:state", "abc"]]);
      const loader = await loadRouteLoaderFromFile(routeFilePath, {
        redirect: (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set("Location", url);
          return new Response(null, { ...init, status: init?.status ?? 302, headers });
        },
        getSession: async () => ({
          get: (key: string) => sessionMap.get(key),
          set: (key: string, value: unknown) => sessionMap.set(key, value),
          unset: (key: string) => sessionMap.delete(key),
        }),
        commitSession: async () => "session=test; Max-Age=30; Path=/",
      });

      const response = await loader({
        request: new Request("https://example.test/callback?state=abc"),
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/ok");
      expect(response.headers.get("Set-Cookie")).toContain("session=test");
      expect(sessionMap.get("done")).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("throws when route module does not export loader", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-loader-"));

    try {
      const routeFilePath = path.join(tempRoot, "no-loader.tsx");
      await writeFile(routeFilePath, `export function component() { return null; }`, "utf8");

      await expect(
        loadRouteLoaderFromFile(routeFilePath, {
          redirect: (url) => new Response(null, { status: 302, headers: { Location: url } }),
          getSession: async () => ({
            get: () => undefined,
            set: () => undefined,
            unset: () => undefined,
          }),
          commitSession: async () => "session=test; Path=/",
        }),
      ).rejects.toThrow("loader export was not found");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("injects named globals for stripped imports", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-loader-"));

    try {
      const routeFilePath = path.join(tempRoot, "authorize.tsx");
      const source = `
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createState } from "~/utils/crypto.server";

export async function loader(_args: LoaderFunctionArgs) {
  return redirect("/next?state=" + createState());
}
`;
      await writeFile(routeFilePath, source, "utf8");
      const loader = await loadRouteLoaderFromFile(routeFilePath, {
        redirect: (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set("Location", url);
          return new Response(null, { ...init, status: init?.status ?? 302, headers });
        },
        getSession: async () => ({
          get: () => undefined,
          set: () => undefined,
          unset: () => undefined,
        }),
        commitSession: async () => "session=test; Path=/",
        globals: {
          createState: () => "state-from-global",
        },
      });

      const response = await loader({
        request: new Request("https://example.test/auth"),
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/next?state=state-from-global");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
