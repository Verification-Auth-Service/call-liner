import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { programToAstJson } from "../ast/program-to-ast-json";

type WriteEntryAstReportsOptions = {
  entries: string[];
  outputDir: string;
  baseDir: string;
};

const PROGRAM_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
]);

function toSafeReportRelativePath(relativePath: string): string {
  const normalizedPath = path.normalize(relativePath);

  const segments = normalizedPath
    .split(path.sep)
    .filter((segment) => segment.length > 0 && segment !== ".")
    .map((segment) => {
      // `..` をそのまま使うと report 外へ出るため安全な文字列に変換する。
      if (segment === "..") {
        return "__parent__";
      }

      return segment;
    });

  // カレントディレクトリそのものが渡された場合でも空ファイル名を避ける。
  if (segments.length === 0) {
    return "entry";
  }

  return segments.join(path.sep);
}

function isProgramFile(filePath: string): boolean {
  return PROGRAM_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function collectProgramFiles(targetPath: string): Promise<string[]> {
  const targetStat = await stat(targetPath);

  // 入力がファイルの場合は、その 1 件のみを解析対象として扱う。
  if (targetStat.isFile()) {
    return [targetPath];
  }

  const collected: string[] = [];
  const directoriesToVisit: string[] = [targetPath];

  while (directoriesToVisit.length > 0) {
    const currentDir = directoriesToVisit.pop();

    // pop の戻り値は undefined の可能性があるため防御的にスキップする。
    if (!currentDir) {
      continue;
    }

    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);

      // ディレクトリは再帰探索対象としてキューへ積む。
      if (entry.isDirectory()) {
        directoriesToVisit.push(entryPath);
        continue;
      }

      // プログラムファイル拡張子のみを AST 生成対象に絞る。
      if (entry.isFile() && isProgramFile(entryPath)) {
        collected.push(entryPath);
      }
    }
  }

  return collected.sort();
}

function toReportRelativePathForSource(
  sourcePath: string,
  entryPath: string,
  baseDir: string,
): string {
  // 絶対パス指定はファイルシステムルート基準の階層を report 側へ再現する。
  if (path.isAbsolute(entryPath)) {
    const rootDir = path.parse(sourcePath).root;
    return path.relative(rootDir, sourcePath);
  }

  // 相対パス指定は呼び出し基準ディレクトリからの相対階層を report 側へ再現する。
  return path.relative(baseDir, sourcePath);
}

/**
 * エントリーファイル群を AST(JSON) として `report` 配下に保存する。
 *
 * 入力例:
 * - entries: ["/tmp/auth/routes.ts", "apps/resource-server/app"]
 * - outputDir: "/work/call-liner/report"
 * - baseDir: "/work/call-liner"
 *
 * 出力例:
 * - "/work/call-liner/report/tmp/auth/routes.ts.json"
 * - "/work/call-liner/report/apps/resource-server/app/routes.ts.json"
 */
export async function writeEntryAstReports(
  options: WriteEntryAstReportsOptions,
): Promise<void> {
  for (const entryPath of options.entries) {
    const sourceRootPath = path.isAbsolute(entryPath)
      ? entryPath
      : path.resolve(options.baseDir, entryPath);
    const sourcePaths = await collectProgramFiles(sourceRootPath);

    for (const sourcePath of sourcePaths) {
      const reportRelativePath = `${toSafeReportRelativePath(toReportRelativePathForSource(sourcePath, entryPath, options.baseDir))}.json`;
      const reportPath = path.join(options.outputDir, reportRelativePath);
      const sourceCode = await readFile(sourcePath, "utf8");
      const astTree = programToAstJson(sourceCode, sourcePath);

      await mkdir(path.dirname(reportPath), { recursive: true });
      await writeFile(reportPath, JSON.stringify(astTree, null, 2), "utf8");
    }
  }
}
