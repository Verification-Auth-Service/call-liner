import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCliArgs } from "../cli/parse-cli-args";
import { promptDeleteOutputDir } from "../cli/prompt-delete-output-dir";
import { writeEntryAstReports } from "./write-entry-ast-reports";

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
  const baseDir = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : process.cwd();
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
  await writeFile(
    path.join(outputDir, "entrypoints.json"),
    JSON.stringify(
      {
        debug: options.debug,
        clientEntry: options.clientEntry,
        resourceEntry: options.resourceEntry,
      },
      null,
      2,
    ),
    "utf8",
  );

  await writeEntryAstReports({
    entries: [options.clientEntry, options.resourceEntry],
    outputDir,
    baseDir,
  });

  console.log(`report ディレクトリを保存しました: ${outputDir}`);
}
