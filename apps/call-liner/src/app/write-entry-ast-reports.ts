import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AstJsonNode } from "../ast/program-to-ast-json";
import ts from "typescript";
import { programToAstJson, sourceFileToAstJson } from "../ast/program-to-ast-json";

type WriteEntryAstReportsOptions = {
  entries: Map<string, string[]>;
  outputDir: string;
  baseDir: string;
};

type CollectEntryAstReportsOptions = {
  entries: Map<string, string[]>;
  baseDir: string;
};

export type CollectedAstReport = {
  sourcePath: string;
  entryPath: string;
  reportRelativePath: string;
  astTree: AstJsonNode;
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

function resolveCompilerOptions(baseDir: string): ts.CompilerOptions {
  const defaultOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    skipLibCheck: true,
    allowJs: true,
  };
  const configPath = ts.findConfigFile(baseDir, ts.sys.fileExists, "tsconfig.json");

  // tsconfig が無い環境でも解析を継続するためデフォルトへフォールバックする。
  if (!configPath) {
    return defaultOptions;
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

  // 読み込み失敗時は失敗させず、最小オプションで Program を生成する。
  if (configFile.error) {
    return defaultOptions;
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
    {},
    configPath,
  );

  return {
    ...defaultOptions,
    ...parsed.options,
    // 入力拡張子セットに .js/.jsx があるため、常に JS 解析を有効化する。
    allowJs: true,
    skipLibCheck: true,
  };
}

/**
 * エントリー配下の AST(JSON) をファイル書き込みせずに収集する。
 *
 * 入力例:
 * - entries: Map([["client", ["/tmp/auth/routes.ts"]], ["resource", ["apps/resource-server/app"]]])
 * - baseDir: "/work/call-liner"
 *
 * 出力例:
 * - [{ sourcePath: "/tmp/auth/routes.ts", entryPath: "/tmp/auth/routes.ts", reportRelativePath: "tmp/auth/routes.ts.json", astTree: {...} }]
 */
export async function collectEntryAstReports(
  options: CollectEntryAstReportsOptions,
): Promise<CollectedAstReport[]> {
  const sourceEntries: Array<{ sourcePath: string; entryPath: string }> = [];
  const sourcePathSet = new Set<string>();

  for (const [, entryPaths] of options.entries) {
    for (const entryPath of entryPaths) {
      const sourceRootPath = path.isAbsolute(entryPath)
        ? entryPath
        : path.resolve(options.baseDir, entryPath);
      const sourcePaths = await collectProgramFiles(sourceRootPath);

      for (const sourcePath of sourcePaths) {
        sourceEntries.push({ sourcePath, entryPath });
        sourcePathSet.add(sourcePath);
      }
    }
  }

  const compilerOptions = resolveCompilerOptions(options.baseDir);
  const sourcePathList = [...sourcePathSet];
  const program = ts.createProgram(sourcePathList, compilerOptions);
  const checker = program.getTypeChecker();

  return sourceEntries.map(({ sourcePath, entryPath }) => {
    const reportRelativePath = `${toSafeReportRelativePath(toReportRelativePathForSource(sourcePath, entryPath, options.baseDir))}.json`;
    const sourceFile = program.getSourceFile(sourcePath);
    const astTree = (() => {
      // Program に含まれる場合はプロジェクト全体の型文脈で AST を生成する。
      if (sourceFile) {
        return sourceFileToAstJson(sourceFile, checker);
      }

      // 何らかの理由で Program 生成に失敗したファイルは単体解析へフォールバックする。
      return programToAstJson(readFileSyncForFallback(sourcePath), sourcePath);
    })();

    return {
      sourcePath,
      entryPath,
      reportRelativePath,
      astTree,
    };
  });
}

/**
 * 収集済み AST(JSON) を指定ディレクトリーへ書き込む。
 *
 * 入力例:
 * - reports: [{ sourcePath: "/tmp/auth/routes.ts", reportRelativePath: "tmp/auth/routes.ts.json", astTree: {...} }]
 * - outputDir: "/work/call-liner/report/source"
 *
 * 出力例:
 * - Map { "/tmp/auth/routes.ts" => "/work/call-liner/report/source/tmp/auth/routes.ts.json" }
 */
export async function writeCollectedAstReports(
  reports: CollectedAstReport[],
  outputDir: string,
): Promise<Map<string, string>> {
  const fileWritePaths = new Map<string, string>();

  for (const report of reports) {
    const reportPath = path.join(outputDir, report.reportRelativePath);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report.astTree, null, 2), "utf8");
    fileWritePaths.set(report.sourcePath, reportPath);
  }

  return fileWritePaths;
}

/**
 * エントリーファイル群を AST(JSON) として `report` 配下に保存する。
 *
 * 入力例:
 * - entries: Map([["client", ["/tmp/auth/routes.ts"]], ["resource", ["apps/resource-server/app"]]])
 * - outputDir: "/work/call-liner/report"
 * - baseDir: "/work/call-liner"
 *
 * 出力例:
 * - "/work/call-liner/report/tmp/auth/routes.ts.json"
 * - "/work/call-liner/report/apps/resource-server/app/routes.ts.json"
 */
export async function writeEntryAstReports(
  options: WriteEntryAstReportsOptions,
): Promise<Map<string, string>> {
  const reports = await collectEntryAstReports({
    entries: options.entries,
    baseDir: options.baseDir,
  });

  return writeCollectedAstReports(reports, options.outputDir);
}

function readFileSyncForFallback(sourcePath: string): string {
  // Program から落ちたファイルでも最終的なレポートは生成する。
  const content = ts.sys.readFile(sourcePath);

  // readFile が undefined を返すケースは空文字列で継続して処理全体停止を避ける。
  if (content === undefined) {
    return "";
  }

  return content;
}
