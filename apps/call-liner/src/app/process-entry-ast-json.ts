import type { AstJsonNode } from "../ast/program-to-ast-json";

export type EntryAstJsonReport = {
  entryType: string;
  sourcePath: string;
  reportRelativePath: string;
  astTree: AstJsonNode;
};

export type EntryAstJson = {
  version: 1;
  generatedAt: string;
  baseDir: string;
  entries: Record<string, string[]>;
  reports: EntryAstJsonReport[];
};

export type ProcessEntryAstJsonResult = {
  totalReports: number;
  reportCountByEntryType: Record<string, number>;
  note: string;
};

/**
 * `--ast-json` で出力された JSON 情報を処理するための雛形メソッド。
 *
 * 入力例:
 * - {
 *   version: 1,
 *   generatedAt: "2026-03-05T09:00:00.000Z",
 *   baseDir: "/work/call-liner",
 *   entries: { client: ["apps/auth-app/app/root.tsx"], resource: ["apps/resource-server/app"] },
 *   reports: [{ entryType: "client", sourcePath: "/work/call-liner/apps/auth-app/app/root.tsx", reportRelativePath: "apps/auth-app/app/root.tsx.json", astTree: {...} }]
 * }
 *
 * 出力例:
 * - { totalReports: 1, reportCountByEntryType: { client: 1 }, note: "TODO: reports をもとに本処理を実装してください。" }
 */
export function processEntryAstJsonTemplate(
  entryAstJson: EntryAstJson,
): ProcessEntryAstJsonResult {
  const reportCountByEntryType: Record<string, number> = {};

  for (const report of entryAstJson.reports) {
    // entryType ごとの処理を分けやすくするため、先に件数を集計する。
    const currentCount = reportCountByEntryType[report.entryType] ?? 0;
    reportCountByEntryType[report.entryType] = currentCount + 1;

    // `client` / `resource` などの種別ごとに後続処理を差し込むための分岐を用意する。
    switch (report.entryType) {
      case "client":
        break;
      case "resource":
        break;
      default:
        // 未知の entryType が来ても処理全体を止めないため、現時点では何もしない。
        break;
    }
  }

  return {
    totalReports: entryAstJson.reports.length,
    reportCountByEntryType,
    note: "TODO: reports をもとに本処理を実装してください。",
  };
}
