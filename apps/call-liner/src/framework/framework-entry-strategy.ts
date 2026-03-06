import { createReactRouterEntryStrategy } from "./react-router-entry-strategy";

export const SUPPORTED_FRAMEWORKS = ["generic", "react-router"] as const;

export type SupportedFramework = (typeof SUPPORTED_FRAMEWORKS)[number];

export type EnumeratedRoute = {
  sourcePath: string;
  routeId: string;
  routePath: string;
};

export interface FrameworkEntryStrategy {
  readonly framework: SupportedFramework;
  resolveEntryPaths(entryPath: string, baseDir: string): Promise<string[]>;
  enumerateRoutes(entryPath: string, baseDir: string): Promise<EnumeratedRoute[]>;
}

/**
 * framework 名からエントリー解決戦略を生成する。
 *
 * 入力例:
 * - "generic"
 * - "react-router"
 *
 * 出力例:
 * - generic 用 strategy インスタンス
 * - react-router 用 strategy インスタンス
 */
export function createFrameworkEntryStrategy(
  framework: SupportedFramework,
): FrameworkEntryStrategy {
  // React Router はディレクトリ命名規約を使ったルート列挙が必要なため専用戦略へ分岐する。
  if (framework === "react-router") {
    return createReactRouterEntryStrategy();
  }

  return {
    framework: "generic",
    async resolveEntryPaths(entryPath: string): Promise<string[]> {
      return [entryPath];
    },
    async enumerateRoutes(): Promise<EnumeratedRoute[]> {
      return [];
    },
  };
}

/**
 * CLI 文字列を SupportedFramework へ検証付きで変換する。
 *
 * 入力例:
 * - "generic"
 * - "react-router"
 *
 * 出力例:
 * - "generic"
 * - "react-router"
 */
export function parseSupportedFramework(
  value: string,
  optionName: string,
): SupportedFramework {
  // 対応外 framework を受け付けると戦略生成で意図しない挙動になるためここで弾く。
  if (!SUPPORTED_FRAMEWORKS.includes(value as SupportedFramework)) {
    throw new Error(
      `${optionName} は ${SUPPORTED_FRAMEWORKS.join(" | ")} のいずれかを指定してください: ${value}`,
    );
  }

  return value as SupportedFramework;
}
