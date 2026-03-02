import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

export function formatCallLine(name: string, phoneNumber: string): string {
  return `${name}: ${phoneNumber}`;
}

type CliOptions = {
  debug: boolean;
  clientEntry: string;
  resourceEntry: string;
};

export function parseCliArgs(argv: string[]): CliOptions {
  let debug = false;
  let clientEntry = "";
  let resourceEntry = "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-d") {
      debug = true;
      continue;
    }
    if (arg === "--client-entry") {
      clientEntry = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--resource-entry") {
      resourceEntry = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
  }

  if (!clientEntry || !resourceEntry) {
    throw new Error(
      "使い方: tsx src/index.ts [-d] --client-entry <path> --resource-entry <path>",
    );
  }

  return { debug, clientEntry, resourceEntry };
}

async function promptDeleteOutputDir(outputDir: string): Promise<boolean> {
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

export async function run(argv: string[]): Promise<void> {
  const options = parseCliArgs(argv);
  const outputDir = path.resolve(process.cwd(), "report");

  if (existsSync(outputDir)) {
    const accepted = await promptDeleteOutputDir(outputDir);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  });
}
