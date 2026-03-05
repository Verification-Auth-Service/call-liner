export type CliOptions = {
  debug: boolean;
  clientEntry: string;
  resourceEntry?: string;
};

/**
 * CLI 引数から実行オプションを抽出する。
 *
 * 入力例:
 * - ["-d", "--client-entry", "/tmp/client.tsx", "--resource-entry", "/tmp/resource.ts"]
 * - ["--client-entry", "/tmp/client.tsx"]
 *
 * 出力例:
 * - { debug: true, clientEntry: "/tmp/client.tsx", resourceEntry: "/tmp/resource.ts" }
 * - { debug: false, clientEntry: "/tmp/client.tsx" }
 */
export function parseCliArgs(argv: string[]): CliOptions {
  let debug = false;
  let clientEntry = "";
  let resourceEntry = "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    // `-d` が指定された場合だけデバッグモードを有効化する。
    if (arg === "-d") {
      debug = true;
      continue;
    }

    // `--client-entry` の直後の値をクライアント側エントリとして取り込む。
    if (arg === "--client-entry") {
      clientEntry = argv[i + 1] ?? "";
      i += 1;
      continue;
    }

    // `--resource-entry` の直後の値をリソース側エントリとして取り込む。
    if (arg === "--resource-entry") {
      resourceEntry = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
  }

  // クライアント側エントリーが無いと最低限の解析対象を決定できないため即時エラーにする。
  if (!clientEntry) {
    throw new Error(
      "使い方: tsx src/index.ts [-d] --client-entry <path> [--resource-entry <path>]",
    );
  }

  // resource 指定は任意のため、空文字列は undefined に正規化して返す。
  return { debug, clientEntry, resourceEntry: resourceEntry || undefined };
}
