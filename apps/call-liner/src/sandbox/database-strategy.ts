export type DatabaseStubStrategyName = "none" | "memory-client";

export type DatabaseStubConfig = {
  strategyName: DatabaseStubStrategyName;
  globalName?: string;
  modelNames?: string[];
};

type DatabaseStubStrategy = {
  createGlobals: () => Record<string, unknown>;
};

/**
 * DB スタブ戦略を解決し、loader へ注入する globals を返す。
 *
 * 入力例:
 * - { strategyName: "none" }
 * - { strategyName: "memory-client", globalName: "prisma", modelNames: ["oAuthAccount"] }
 * 出力例:
 * - {}
 * - { prisma: { oAuthAccount: { upsert: async () => ({}) } } }
 */
export const buildDatabaseStrategyGlobals = (
  config: DatabaseStubConfig,
): Record<string, unknown> => {
  const strategy = resolveDatabaseStubStrategy(config);
  return strategy.createGlobals();
};

const resolveDatabaseStubStrategy = (
  config: DatabaseStubConfig,
): DatabaseStubStrategy => {
  // "none" は DB 依存を注入しない既定動作として扱う。
  if (config.strategyName === "none") {
    return {
      createGlobals: () => ({}),
    };
  }

  // memory-client は DB クライアント風オブジェクトをメモリ実装で注入する。
  if (config.strategyName === "memory-client") {
    return createMemoryClientStrategy(config);
  }

  throw new Error(`Unknown database strategy: ${config.strategyName}`);
};

const createMemoryClientStrategy = (
  config: DatabaseStubConfig,
): DatabaseStubStrategy => {
  const globalName = config.globalName ?? "db";
  const modelNames = config.modelNames ?? [];

  // model 未指定だとルート側の参照を満たせないため明示的に失敗させる。
  if (modelNames.length === 0) {
    throw new Error(
      "memory-client strategy requires at least one --database-model value",
    );
  }

  const client = Object.fromEntries(
    modelNames.map((modelName) => [modelName, createMemoryModelDelegate()]),
  );

  return {
    createGlobals: () => ({
      [globalName]: client,
    }),
  };
};

const createMemoryModelDelegate = (): Record<string, unknown> => {
  return {
    upsert: async (args: { update?: unknown; create?: unknown } = {}) => {
      // upsert は update/create いずれかの入力を返し、呼び出し先の期待を満たす。
      if (args.update !== undefined) {
        return args.update;
      }

      if (args.create !== undefined) {
        return args.create;
      }

      return {};
    },
    create: async (args: { data?: unknown } = {}) => args.data ?? {},
    update: async (args: { data?: unknown } = {}) => args.data ?? {},
    findUnique: async () => null,
    findFirst: async () => null,
    findMany: async () => [],
    delete: async (args: { where?: unknown } = {}) => args.where ?? {},
  };
};
