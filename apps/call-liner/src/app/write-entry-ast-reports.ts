import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { programToAstJson, sourceFileToAstJson } from "../ast/program-to-ast-json";

type WriteEntryAstReportsOptions = {
  entries: Map<string, string[]>;
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
  const fileWritePaths = new Map<string, string>();
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

  for (const { sourcePath, entryPath } of sourceEntries) {
    const reportRelativePath = `${toSafeReportRelativePath(toReportRelativePathForSource(sourcePath, entryPath, options.baseDir))}.json`;
    const reportPath = path.join(options.outputDir, reportRelativePath);
    const sourceFile = program.getSourceFile(sourcePath);
    const astTree = (() => {
      // Program に含まれる場合はプロジェクト全体の型文脈で AST を生成する。
      if (sourceFile) {
        return sourceFileToAstJson(sourceFile, checker);
      }

      // 何らかの理由で Program 生成に失敗したファイルは単体解析へフォールバックする。
      return programToAstJson(readFileSyncForFallback(sourcePath), sourcePath);
    })();

    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(astTree, null, 2), "utf8");
    fileWritePaths.set(sourcePath, reportPath);
  }

  return fileWritePaths;
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
