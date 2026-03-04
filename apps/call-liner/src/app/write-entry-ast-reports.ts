import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { programToAstJson } from "../ast/program-to-ast-json";

type WriteEntryAstReportsOptions = {
  entries: string[];
  outputDir: string;
  baseDir: string;
};

function toReportRelativePath(entryPath: string): string {
  const normalizedPath = path.normalize(entryPath);

  // 絶対パス指定はルート記号を除去し、元の階層をそのまま report 配下へ写す。
  if (path.isAbsolute(normalizedPath)) {
    const rootDir = path.parse(normalizedPath).root;
    return path.relative(rootDir, normalizedPath);
  }

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

/**
 * エントリーファイル群を AST(JSON) として `report` 配下に保存する。
 *
 * 入力例:
 * - entries: ["/tmp/auth/routes.ts", "apps/resource-server/app/routes.ts"]
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
    const sourcePath = path.isAbsolute(entryPath)
      ? entryPath
      : path.resolve(options.baseDir, entryPath);
    const reportRelativePath = `${toReportRelativePath(entryPath)}.json`;
    const reportPath = path.join(options.outputDir, reportRelativePath);

    const sourceCode = await readFile(sourcePath, "utf8");
    const astTree = programToAstJson(sourceCode, sourcePath);

    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(astTree, null, 2), "utf8");
  }
}
