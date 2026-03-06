import { describe, expect, it } from "vitest";
import { buildDatabaseStrategyGlobals } from "./database-strategy";

describe("buildDatabaseStrategyGlobals", () => {
  it("returns empty globals for none strategy", () => {
    const globals = buildDatabaseStrategyGlobals({
      strategyName: "none",
    });

    expect(globals).toEqual({});
  });

  it("builds memory-client delegate and supports upsert", async () => {
    const globals = buildDatabaseStrategyGlobals({
      strategyName: "memory-client",
      globalName: "prisma",
      modelNames: ["oAuthAccount"],
    });
    const prisma = globals.prisma as {
      oAuthAccount: {
        upsert: (args: { update?: unknown; create?: unknown }) => Promise<unknown>;
      };
    };

    const result = await prisma.oAuthAccount.upsert({
      update: { accessToken: "updated" },
      create: { accessToken: "created" },
    });

    expect(result).toEqual({ accessToken: "updated" });
  });

  it("throws when memory-client has no model names", () => {
    expect(() =>
      buildDatabaseStrategyGlobals({
        strategyName: "memory-client",
        globalName: "prisma",
      }),
    ).toThrow("memory-client strategy requires at least one --database-model value");
  });
});
