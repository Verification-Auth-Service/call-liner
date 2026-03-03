import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCliArgs } from "../cli/parse-cli-args";
import { promptDeleteOutputDir } from "../cli/prompt-delete-output-dir";

export async function run(argv: string[]): Promise<void> {
  const options = parseCliArgs(argv);
  const outputDir = path.resolve(process.cwd(), "report");

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

  console.log(`report ディレクトリを保存しました: ${outputDir}`);
}
