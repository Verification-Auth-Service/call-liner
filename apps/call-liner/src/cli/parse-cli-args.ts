import {
  parseSupportedFramework,
  type SupportedFramework,
} from "../framework/framework-entry-strategy";

export type CliOptions = {
  debug: boolean;
  outputAstJson: boolean;
  clientEntry: string;
  resourceEntry?: string;
  clientFramework: SupportedFramework;
  resourceFramework: SupportedFramework;
};

/**
 * CLI 引数から実行オプションを抽出する。
 *
 * 入力例:
 * - ["-d", "--ast-json", "--client-entry", "/tmp/client.tsx", "--resource-entry", "/tmp/resource.ts", "--client-framework", "react-router"]
 * - ["--client-entry", "/tmp/client.tsx"]
 *
 * 出力例:
 * - { debug: true, outputAstJson: true, clientEntry: "/tmp/client.tsx", resourceEntry: "/tmp/resource.ts", clientFramework: "react-router", resourceFramework: "generic" }
 * - { debug: false, outputAstJson: false, clientEntry: "/tmp/client.tsx", clientFramework: "generic", resourceFramework: "generic" }
 */
export function parseCliArgs(argv: string[]): CliOptions {
  let debug = false;
  let outputAstJson = false;
  let clientEntry = "";
  let resourceEntry = "";
  let clientFramework: SupportedFramework = "generic";
  let resourceFramework: SupportedFramework = "generic";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    // `-d` が指定された場合だけデバッグモードを有効化する。
    if (arg === "-d") {
      debug = true;
      continue;
    }

    // `--ast-json` が指定された場合だけ、AST 一括 JSON の出力を有効化する。
    if (arg === "--ast-json") {
      outputAstJson = true;
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

    // `--client-framework` が指定された場合は対応 framework のみを受け付ける。
    if (arg === "--client-framework") {
      clientFramework = parseSupportedFramework(
        argv[i + 1] ?? "",
        "--client-framework",
      );
      i += 1;
      continue;
    }

    // `--resource-framework` が指定された場合は対応 framework のみを受け付ける。
    if (arg === "--resource-framework") {
      resourceFramework = parseSupportedFramework(
        argv[i + 1] ?? "",
        "--resource-framework",
      );
      i += 1;
      continue;
    }
  }

  // クライアント側エントリーが無いと最低限の解析対象を決定できないため即時エラーにする。
  if (!clientEntry) {
    throw new Error(
      "使い方: tsx src/index.ts [-d] [--ast-json] --client-entry <path> [--resource-entry <path>] [--client-framework <generic|react-router>] [--resource-framework <generic|react-router>]",
    );
  }

  // resource 指定は任意のため、空文字列は undefined に正規化して返す。
  return {
    debug,
    outputAstJson,
    clientEntry,
    resourceEntry: resourceEntry || undefined,
    clientFramework,
    resourceFramework,
  };
}
