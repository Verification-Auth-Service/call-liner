import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCliArgs } from "../cli/parse-cli-args";
import { promptDeleteOutputDir } from "../cli/prompt-delete-output-dir";
import { writeEntryAstReports } from "./write-entry-ast-reports";

interface WrittenFilesTree {
  [key: string]: WrittenFilesTree | string;
}

function resolveEntryPath(baseDir: string, entryPath: string): string {
  return path.isAbsolute(entryPath)
    ? entryPath
    : path.resolve(baseDir, entryPath);
}

function matchesEntryPath(
  sourcePath: string,
  resolvedEntryPath: string,
): boolean {
  const normalizedSourcePath = path.normalize(sourcePath);
  const normalizedEntryPath = path.normalize(resolvedEntryPath);

  // エントリーがファイルなら完全一致、ディレクトリーなら配下ファイルを一致対象にする。
  return (
    normalizedSourcePath === normalizedEntryPath ||
    normalizedSourcePath.startsWith(`${normalizedEntryPath}${path.sep}`)
  );
}

function setTreeValue(
  tree: WrittenFilesTree,
  relativePath: string,
  fileValue: string,
): void {
  const segments = relativePath
    .split(path.sep)
    .filter((segment) => segment.length > 0);
  const fileName = segments.pop();

  // 空パスはファイルとして扱えないため何もしない。
  if (!fileName) {
    return;
  }

  let currentNode = tree;

  for (const segment of segments) {
    const existingNode = currentNode[segment];

    // 同名キーがファイル値の場合でも、構造維持を優先してディレクトリーへ置き換える。
    if (!existingNode || typeof existingNode === "string") {
      currentNode[segment] = {};
    }

    currentNode = currentNode[segment] as WrittenFilesTree;
  }

  currentNode[fileName] = fileValue;
}

function buildWrittenFilesByEntry(
  entries: Map<string, string[]>,
  writtenFiles: Map<string, string>,
  baseDir: string,
  outputDir: string,
): Record<string, WrittenFilesTree> {
  const result: Record<string, WrittenFilesTree> = {};

  for (const [entryType] of entries) {
    result[entryType] = {};
  }

  for (const [sourcePath, reportPath] of writtenFiles.entries()) {
    for (const [entryType, entryPaths] of entries.entries()) {
      const matchedEntryPath = entryPaths.find((entryPath) =>
        matchesEntryPath(sourcePath, resolveEntryPath(baseDir, entryPath)),
      );

      // エントリーに紐づく sourcePath だけ writtenFiles へ反映する。
      if (!matchedEntryPath) {
        continue;
      }

      const reportRelativePath = path.relative(outputDir, reportPath);
      setTreeValue(result[entryType], reportRelativePath, reportRelativePath);
      break;
    }
  }

  return result;
}

/**
 * CLI 引数を解釈してレポート出力を実行する。
 *
 * 入力例:
 * - ["-d", "--client-entry", "/tmp/client.tsx", "--resource-entry", "apps/resource-server/app/routes.ts"]
 *
 * 出力例:
 * - report/entrypoints.json と report 配下の AST(JSON) ファイルが生成される
 */
export async function run(argv: string[]): Promise<void> {
  const options = parseCliArgs(argv);

  // pnpm 経由実行では INIT_CWD が起点ディレクトリになるため、相対パス解決の基準に使う。
  const baseDir = process.env.INIT_CWD
    ? path.resolve(process.env.INIT_CWD)
    : process.cwd();
  const outputDir = path.resolve(baseDir, "report");

  // 既存の出力先がある場合は、誤上書きを避けるために確認を挟む。
  if (existsSync(outputDir)) {
    const accepted = await promptDeleteOutputDir(outputDir);

    // ユーザーが拒否した場合は副作用を起こさず終了する。
    if (!accepted) {
      console.error("中止しました。");
      process.exitCode = 1;
      return;
    }

    await rm(outputDir, { recursive: true, force: true });
  }

  await mkdir(outputDir, { recursive: true });
  const entries = new Map<string, string[]>([
    ["client", [options.clientEntry]],
    ["resource", [options.resourceEntry]],
  ]);

  const writtenFiles = await writeEntryAstReports({
    entries,
    outputDir,
    baseDir,
  });

  console.log(`生成されたファイル:`);
  for (const file of writtenFiles.values()) {
    console.log(`  - ${file}`);
  }

  await writeFile(
    path.join(outputDir, "entrypoints.json"),
    JSON.stringify(
      {
        debug: options.debug,
        clientEntry: options.clientEntry,
        resourceEntry: options.resourceEntry,
        writtenFiles: buildWrittenFilesByEntry(
          entries,
          writtenFiles,
          baseDir,
          outputDir,
        ),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`report ディレクトリを保存しました: ${outputDir}`);
}
