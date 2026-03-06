import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  EnumeratedRoute,
  FrameworkEntryStrategy,
} from "./framework-entry-strategy";

const PROGRAM_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
]);

const ROOT_FILE_CANDIDATES = [
  "root.tsx",
  "root.ts",
  "root.jsx",
  "root.js",
  "root.mts",
  "root.cts",
];

/**
 * React Router 向けエントリー戦略を作成する。
 *
 * 入力例:
 * - なし
 *
 * 出力例:
 * - framework: "react-router" の strategy
 */
export function createReactRouterEntryStrategy(): FrameworkEntryStrategy {
  return {
    framework: "react-router",
    async resolveEntryPaths(entryPath: string, baseDir: string): Promise<string[]> {
      const appDirectory = await resolveAppDirectory(entryPath, baseDir);
      const routeDirectory = path.join(appDirectory, "routes");
      const routeFiles = await collectProgramFiles(routeDirectory);
      const rootFile = await resolveRootFile(appDirectory);
      const resolvedEntries = [
        ...(rootFile ? [rootFile] : []),
        ...routeFiles,
      ];

      // ルートが 1 件も解決できない場合は設定ミスの可能性が高いため明示エラーで通知する。
      if (resolvedEntries.length === 0) {
        throw new Error(
          `react-router のルートを解決できませんでした: ${entryPath}`,
        );
      }

      return resolvedEntries;
    },
    async enumerateRoutes(
      entryPath: string,
      baseDir: string,
    ): Promise<EnumeratedRoute[]> {
      const appDirectory = await resolveAppDirectory(entryPath, baseDir);
      const routeDirectory = path.join(appDirectory, "routes");
      const routeFiles = await collectProgramFiles(routeDirectory);

      return routeFiles.map((sourcePath) => {
        const routeId = toPosixRelativePath(routeDirectory, sourcePath).replace(
          /\.[^/.]+$/,
          "",
        );

        return {
          sourcePath,
          routeId,
          routePath: toReactRouterRoutePath(routeId),
        };
      });
    },
  };
}

function toPosixRelativePath(baseDir: string, sourcePath: string): string {
  const relativePath = path.posix.normalize(
    path.relative(baseDir, sourcePath).split(path.sep).join(path.posix.sep),
  );

  // routeId 生成で空文字が入ると識別子が壊れるため "." を返す。
  if (!relativePath) {
    return ".";
  }

  return relativePath;
}

async function resolveAppDirectory(
  entryPath: string,
  baseDir: string,
): Promise<string> {
  const resolvedPath = path.isAbsolute(entryPath)
    ? entryPath
    : path.resolve(baseDir, entryPath);
  const entryStat = await stat(resolvedPath);

  // エントリーがファイル指定ならその親を app ディレクトリとして扱う。
  if (entryStat.isFile()) {
    return path.dirname(resolvedPath);
  }

  // `app` 直指定時はそのまま採用し、プロジェクトルート指定時は `app` 配下を優先する。
  if (path.basename(resolvedPath) === "app") {
    return resolvedPath;
  }

  const nestedAppDirectory = path.join(resolvedPath, "app");
  // プロジェクトルートが渡された場合でも React Router 標準配置の `app` を優先する。
  if (await isDirectory(nestedAppDirectory)) {
    return nestedAppDirectory;
  }

  return resolvedPath;
}

async function resolveRootFile(appDirectory: string): Promise<string | undefined> {
  for (const fileName of ROOT_FILE_CANDIDATES) {
    const candidatePath = path.join(appDirectory, fileName);

    // ルート候補は最初に見つかった 1 件のみを採用して重複読み込みを避ける。
    if (await isFile(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

async function collectProgramFiles(targetDirectory: string): Promise<string[]> {
  // `routes` ディレクトリーが無いプロジェクトでも空配列で継続して上位判定に任せる。
  if (!(await isDirectory(targetDirectory))) {
    return [];
  }

  const collected: string[] = [];
  const directoriesToVisit: string[] = [targetDirectory];

  while (directoriesToVisit.length > 0) {
    const currentDir = directoriesToVisit.pop();

    // pop の戻り値は undefined の可能性があるため防御的にスキップする。
    if (!currentDir) {
      continue;
    }

    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);

      // ルーティング列挙では隠しディレクトリを解析対象外にしてノイズを減らす。
      if (entry.name.startsWith(".")) {
        continue;
      }

      // サブディレクトリーは URL セグメント候補を持つため探索キューへ積む。
      if (entry.isDirectory()) {
        directoriesToVisit.push(entryPath);
        continue;
      }

      // React Router の route module 候補になり得る拡張子のみを対象にする。
      if (entry.isFile() && isProgramFile(entryPath)) {
        collected.push(entryPath);
      }
    }
  }

  return collected.sort();
}

function isProgramFile(filePath: string): boolean {
  return PROGRAM_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isFile();
  } catch {
    return false;
  }
}

function toReactRouterRoutePath(routeId: string): string {
  const pathTokens: string[] = [];

  for (const slashSegment of routeId.split("/")) {
    const dotSegments = slashSegment.split(".");

    for (const token of dotSegments) {
      const normalizedToken = token.trim();

      // ファイル名 `route.tsx` はディレクトリー自身の URL を表すためセグメントへ追加しない。
      if (!normalizedToken || normalizedToken === "route") {
        continue;
      }

      // index は親パスを指すため URL セグメントを増やさない。
      if (normalizedToken === "index" || normalizedToken === "_index") {
        continue;
      }

      // Pathless layout (`_auth`) は URL へ現れないためスキップする。
      if (normalizedToken.startsWith("_")) {
        continue;
      }

      // スプラットは React Router の `*` として扱う。
      if (normalizedToken === "$") {
        pathTokens.push("*");
        continue;
      }

      // `$id` 形式は動的セグメントとして `:id` に変換する。
      if (normalizedToken.startsWith("$")) {
        pathTokens.push(`:${normalizedToken.slice(1)}`);
        continue;
      }

      // `segment_` は URL 上のセグメント自体は残し、ネスト規則だけを切り離す記法として扱う。
      if (normalizedToken.endsWith("_")) {
        pathTokens.push(normalizedToken.slice(0, -1));
        continue;
      }

      pathTokens.push(normalizedToken);
    }
  }

  // ルートセグメントが空の場合はトップ (`/`) として返す。
  if (pathTokens.length === 0) {
    return "/";
  }

  return `/${pathTokens.join("/")}`;
}
