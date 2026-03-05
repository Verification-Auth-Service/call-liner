import { createInterface } from "node:readline/promises";

export async function promptDeleteOutputDir(
  outputDir: string,
): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rl.question(
    `出力ディレクトリは既に存在します: ${outputDir}\n削除して再作成しますか？ [y/N] `,
  );

  rl.close();
  return answer.trim().toLowerCase() === "y";
}
