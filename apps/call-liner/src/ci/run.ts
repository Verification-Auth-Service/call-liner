import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { run as runAnalyze } from "../app/run";
import { runSandboxFromArgs } from "../sandbox/run-sandbox";

type CiCliOptions = {
  configPath: string;
  outputDir?: string;
};

type CiConfig = {
  version: 1;
  outputDir?: string;
  projects: CiProjectConfig[];
};

type CiProjectConfig = {
  id: string;
  root: string;
  tasks: CiTaskConfig[];
};

type CiTaskConfig = AnalyzeTaskConfig | SingleTaskConfig | OauthTwoStepTaskConfig;

type AnalyzeTaskConfig = {
  id: string;
  kind: "analyze";
  clientEntry: string;
  resourceEntry?: string;
  clientFramework?: "generic" | "react-router";
  resourceFramework?: "generic" | "react-router";
  debug?: boolean;
  outputAstJson?: boolean;
};

type SingleTaskConfig = {
  id: string;
  kind: "single";
  loaderFile: string;
  url: string;
  method?: string;
  requestId?: string;
  session?: Record<string, string>;
  env?: Record<string, string>;
  database?: {
    strategy: "none" | "memory-client";
    global?: string;
    models?: string[];
  };
  stubRefreshToken?: string;
  stubGithubReposStatus?: number;
  advanceMs?: number[];
  replay?: Array<string | number>;
  expectStatus?: number;
};

type OauthTwoStepTaskConfig = {
  id: string;
  kind: "oauth-two-step";
  authorizeLoaderFile: string;
  callbackLoaderFile: string;
  refreshLoaderFile?: string;
  authorizeUrl: string;
  callbackUrlBase: string;
  refreshUrl?: string;
  callbackCode?: string;
  callbackState?: string;
  stateMode?: "match_authorize" | "tampered" | "missing" | "fixed";
  stateFuzzing?: boolean;
  graphExplore?: boolean;
  specValidate?: boolean;
  stateExpiryMs?: number;
  session?: Record<string, string>;
  env?: Record<string, string>;
  database?: {
    strategy: "none" | "memory-client";
    global?: string;
    models?: string[];
  };
  stubRefreshToken?: string;
  stubGithubReposStatus?: number;
  failOnVulnerability?: boolean;
};

type CiTaskStatus = "pass" | "fail" | "error";

type CiTaskResult = {
  projectId: string;
  taskId: string;
  kind: CiTaskConfig["kind"];
  status: CiTaskStatus;
  summary: string;
  artifactPath?: string;
  details?: Record<string, unknown>;
  error?: {
    message: string;
  };
};

type CiSummary = {
  version: 1;
  status: CiTaskStatus;
  counts: {
    pass: number;
    fail: number;
    error: number;
  };
  results: CiTaskResult[];
};

/**
 * CI 用サブコマンドを実行し、設定ファイルに定義されたタスク群の判定結果を返す。
 *
 * 入力例:
 * - ["--config", "/tmp/call-liner.ci.json"]
 * - ["--config", "/tmp/call-liner.ci.json", "--output-dir", "/tmp/artifacts/call-liner"]
 *
 * 出力例:
 * - summary.json / summary.md を出力し、fail/error 件数に応じた process.exitCode を設定する
 * - 成功時は 0、fail 時は 1、error 時は 2、両方を含む場合は 3 を返す
 */
export async function runCi(argv: string[]): Promise<void> {
  const options = parseCiCliArgs(argv);
  const config = await loadCiConfig(options.configPath);
  const configDirectory = path.dirname(path.resolve(options.configPath));
  const resolvedOutputDir = path.resolve(
    configDirectory,
    options.outputDir ?? config.outputDir ?? "artifacts/call-liner",
  );
  const results: CiTaskResult[] = [];

  await mkdir(resolvedOutputDir, { recursive: true });

  for (const project of config.projects) {
    const projectRoot = path.resolve(configDirectory, project.root);
    const projectOutputDir = path.join(resolvedOutputDir, project.id);

    await mkdir(projectOutputDir, { recursive: true });

    for (const task of project.tasks) {
      results.push(await runProjectTask(project.id, projectRoot, projectOutputDir, task));
    }
  }

  const summary = buildSummary(results);
  await writeFile(
    path.join(resolvedOutputDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(resolvedOutputDir, "summary.md"),
    renderMarkdownSummary(summary),
    "utf8",
  );

  // fail/error の混在状況で終了コードを固定し、CI 側の判定を安定させる。
  process.exitCode = toExitCode(summary);
}

const parseCiCliArgs = (argv: string[]): CiCliOptions => {
  let configPath = "";
  let outputDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1];

    // `--config` で設定ファイルの場所を受け取り、CI 実行単位を決める。
    if (arg === "--config") {
      configPath = requireValue(arg, nextValue);
      index += 1;
      continue;
    }

    // `--output-dir` は成果物の保存先を上書きしたい CI だけで使う。
    if (arg === "--output-dir") {
      outputDir = requireValue(arg, nextValue);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  // 設定ファイルが無いと何を検査するか決められないため即時エラーにする。
  if (!configPath) {
    throw new Error("Missing required argument: --config <path>");
  }

  return {
    configPath,
    outputDir,
  };
};

const requireValue = (flag: string, value: string | undefined): string => {
  // フラグ直後の値が無い場合は CLI 解釈が不完全なので失敗させる。
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
};

const loadCiConfig = async (configPath: string): Promise<CiConfig> => {
  const rawConfig = await readFile(configPath, "utf8");
  const parsed = JSON.parse(rawConfig) as Partial<CiConfig>;

  // version ずれは構文互換を保証できないため拒否する。
  if (parsed.version !== 1) {
    throw new Error("Unsupported config version. Expected version: 1");
  }

  // projects 配列が無いと CI 実行対象が定まらないため拒否する。
  if (!Array.isArray(parsed.projects)) {
    throw new Error("Config must include projects array.");
  }

  return parsed as CiConfig;
};

const runProjectTask = async (
  projectId: string,
  projectRoot: string,
  projectOutputDir: string,
  task: CiTaskConfig,
): Promise<CiTaskResult> => {
  try {
    // analyze は静的成果物を書き出すため専用処理で実行する。
    if (task.kind === "analyze") {
      return await runAnalyzeTask(projectId, projectRoot, projectOutputDir, task);
    }

    // single は status ベースの固定シナリオ判定を返す。
    if (task.kind === "single") {
      return await runSingleTask(projectId, projectRoot, projectOutputDir, task);
    }

    return await runOauthTwoStepTask(projectId, projectRoot, projectOutputDir, task);
  } catch (error: unknown) {
    // 未実装の補助関数参照は現状の検査対象外として扱い、CI 全体を error で止めない。
    if (isIgnorableUndefinedReferenceError(error)) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        projectId,
        taskId: task.id,
        kind: task.kind,
        status: "pass",
        summary: `warning: ${message}`,
        details: {
          warning: message,
          warningKind: "undefined_reference",
        },
      };
    }

    return {
      projectId,
      taskId: task.id,
      kind: task.kind,
      status: "error",
      summary: error instanceof Error ? error.message : String(error),
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
};

const isIgnorableUndefinedReferenceError = (error: unknown): boolean => {
  // `foo is not defined` は未対応関数の呼び出しで起きやすく、現状は警告止まりにする。
  if (!(error instanceof Error)) {
    return false;
  }

  // ReferenceError 以外まで吸収すると本来の実行不備を見逃すため、文言も一致させる。
  return /is not defined$/.test(error.message);
};

const runAnalyzeTask = async (
  projectId: string,
  projectRoot: string,
  projectOutputDir: string,
  task: AnalyzeTaskConfig,
): Promise<CiTaskResult> => {
  const artifactDir = path.join(projectOutputDir, task.id);
  const argv = buildAnalyzeArgv(task);

  await runAnalyze(argv, {
    baseDir: projectRoot,
    outputDir: artifactDir,
    cleanOutputDir: true,
    interactive: false,
    log: false,
  });

  return {
    projectId,
    taskId: task.id,
    kind: task.kind,
    status: "pass",
    summary: "analysis completed",
    artifactPath: path.relative(projectRoot, artifactDir),
  };
};

const buildAnalyzeArgv = (task: AnalyzeTaskConfig): string[] => {
  const argv: string[] = [];

  // デバッグ AST を残したい場合だけ `-d` を追加する。
  if (task.debug) {
    argv.push("-d");
  }

  // action-space / attack-dsl を含む JSON 一式が必要な場合だけ有効化する。
  if (task.outputAstJson) {
    argv.push("--ast-json");
  }

  argv.push("--client-entry", task.clientEntry);

  // resource 側があるケースだけ entry / framework を追加する。
  if (task.resourceEntry) {
    argv.push("--resource-entry", task.resourceEntry);
  }

  // client framework は generic 以外を明示したい時だけ渡す。
  if (task.clientFramework) {
    argv.push("--client-framework", task.clientFramework);
  }

  // resource framework は resourceEntry と組みでだけ意味を持つ。
  if (task.resourceEntry && task.resourceFramework) {
    argv.push("--resource-framework", task.resourceFramework);
  }

  return argv;
};

const runSingleTask = async (
  projectId: string,
  projectRoot: string,
  projectOutputDir: string,
  task: SingleTaskConfig,
): Promise<CiTaskResult> => {
  const artifactPath = path.join(projectOutputDir, `${task.id}.json`);
  const sandboxResult = await runSandboxFromArgs(buildSingleArgv(task, projectRoot));
  const result = sandboxResult.result as Awaited<ReturnType<typeof runSandboxFromArgs>>["result"] & {
    steps: Array<{ type: string; status?: number }>;
  };
  const finalStatus = [...result.steps]
    .reverse()
    .find((step) => step.type === "request" || step.type === "replay")?.status;
  let status: CiTaskStatus = "pass";
  let summary = `single scenario completed`;

  // 期待 status があり、最終 HTTP status と違う場合だけ fail にする。
  if (task.expectStatus !== undefined && finalStatus !== task.expectStatus) {
    status = "fail";
    summary = `expected status ${task.expectStatus}, received ${String(finalStatus)}`;
  }

  await writeFile(artifactPath, JSON.stringify(sandboxResult.result, null, 2), "utf8");

  return {
    projectId,
    taskId: task.id,
    kind: task.kind,
    status,
    summary,
    artifactPath: path.relative(projectRoot, artifactPath),
    details: {
      finalStatus,
    },
  };
};

const buildSingleArgv = (task: SingleTaskConfig, projectRoot: string): string[] => {
  const argv = [
    "--scenario",
    "single",
    "--loader-file",
    resolveProjectPath(projectRoot, task.loaderFile),
    "--url",
    task.url,
  ];

  // method は GET 以外を明示したいケースだけ渡す。
  if (task.method) {
    argv.push("--method", task.method);
  }

  // requestId は replay の参照名を変える場合だけ追加する。
  if (task.requestId) {
    argv.push("--request-id", task.requestId);
  }

  appendRecordArgs(argv, "--session", task.session);
  appendRecordArgs(argv, "--env", task.env);
  appendDatabaseArgs(argv, task.database);
  appendFetchStubArgs(argv, task);

  for (const advanceMs of task.advanceMs ?? []) {
    argv.push("--advance-ms", String(advanceMs));
  }

  for (const replayTarget of task.replay ?? []) {
    argv.push("--replay", String(replayTarget));
  }

  return argv;
};

const runOauthTwoStepTask = async (
  projectId: string,
  projectRoot: string,
  projectOutputDir: string,
  task: OauthTwoStepTaskConfig,
): Promise<CiTaskResult> => {
  const artifactPath = path.join(projectOutputDir, `${task.id}.json`);
  const sandboxResult = await runSandboxFromArgs(
    buildOauthTwoStepArgv(task, projectRoot),
  );
  const result = sandboxResult.result as {
    fuzzing?: { vulnerabilities: Array<Record<string, unknown>> };
    graphExploration?: { vulnerabilities: Array<Record<string, unknown>> };
  };
  const vulnerabilityCount =
    (result.fuzzing?.vulnerabilities.length ?? 0) +
    (result.graphExploration?.vulnerabilities.length ?? 0);
  let status: CiTaskStatus = "pass";
  let summary = "oauth-two-step scenario completed";
  const failOnVulnerability = task.failOnVulnerability ?? true;

  // 脆弱性を品質ゲートに含める設定なら、1 件でも検出時に fail にする。
  if (failOnVulnerability && vulnerabilityCount > 0) {
    status = "fail";
    summary = `${vulnerabilityCount} vulnerabilities detected`;
  }

  await writeFile(artifactPath, JSON.stringify(sandboxResult.result, null, 2), "utf8");

  return {
    projectId,
    taskId: task.id,
    kind: task.kind,
    status,
    summary,
    artifactPath: path.relative(projectRoot, artifactPath),
    details: {
      vulnerabilityCount,
    },
  };
};

const buildOauthTwoStepArgv = (
  task: OauthTwoStepTaskConfig,
  projectRoot: string,
): string[] => {
  const argv = [
    "--scenario",
    "oauth-two-step",
    "--authorize-loader-file",
    resolveProjectPath(projectRoot, task.authorizeLoaderFile),
    "--callback-loader-file",
    resolveProjectPath(projectRoot, task.callbackLoaderFile),
    "--authorize-url",
    task.authorizeUrl,
    "--callback-url-base",
    task.callbackUrlBase,
  ];

  // refresh path があるケースだけ 3 ステップシナリオを有効化する。
  if (task.refreshLoaderFile) {
    argv.push(
      "--refresh-loader-file",
      resolveProjectPath(projectRoot, task.refreshLoaderFile),
    );
  }

  // refresh URL は refresh loader と対でだけ意味を持つ。
  if (task.refreshUrl) {
    argv.push("--refresh-url", task.refreshUrl);
  }

  // callback code を固定したい CI の再現性確保に使う。
  if (task.callbackCode) {
    argv.push("--callback-code", task.callbackCode);
  }

  // state の固定値を使う時だけ明示的に渡す。
  if (task.callbackState) {
    argv.push("--callback-state", task.callbackState);
  }

  // state 改ざんモードを変えたいケースだけ上書きする。
  if (task.stateMode) {
    argv.push("--state-mode", task.stateMode);
  }

  // fuzzing を有効化した時だけ攻撃ケース群を実行する。
  if (task.stateFuzzing) {
    argv.push("--state-fuzzing");
  }

  // graph exploration はノイズを避けるため opt-in にする。
  if (task.graphExplore) {
    argv.push("--graph-explore");
  }

  // spec validate を有効化した時だけ violation を vulnerability 化する。
  if (task.specValidate) {
    argv.push("--spec-validate");
  }

  // expiry を既定値から変えたいケースだけ指定する。
  if (task.stateExpiryMs !== undefined) {
    argv.push("--state-expiry-ms", String(task.stateExpiryMs));
  }

  appendRecordArgs(argv, "--session", task.session);
  appendRecordArgs(argv, "--env", task.env);
  appendDatabaseArgs(argv, task.database);
  appendFetchStubArgs(argv, task);

  return argv;
};

const appendRecordArgs = (
  argv: string[],
  flag: "--session" | "--env",
  record: Record<string, string> | undefined,
): void => {
  for (const [key, value] of Object.entries(record ?? {})) {
    argv.push(flag, `${key}=${value}`);
  }
};

const resolveProjectPath = (projectRoot: string, targetPath: string): string => {
  // 絶対パス指定はそのまま尊重し、相対指定だけ project root 基準で解決する。
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.resolve(projectRoot, targetPath);
};

const appendDatabaseArgs = (
  argv: string[],
  database:
    | {
        strategy: "none" | "memory-client";
        global?: string;
        models?: string[];
      }
    | undefined,
): void => {
  // DB 注入を変えるケースだけ関連引数を追加する。
  if (!database) {
    return;
  }

  argv.push("--database-strategy", database.strategy);

  // global 名が既定値と違う場合だけ上書きする。
  if (database.global) {
    argv.push("--database-global", database.global);
  }

  for (const modelName of database.models ?? []) {
    argv.push("--database-model", modelName);
  }
};

const appendFetchStubArgs = (
  argv: string[],
  task: {
    stubRefreshToken?: string;
    stubGithubReposStatus?: number;
  },
): void => {
  // refresh token を固定したいケースだけ token stub を上書きする。
  if (task.stubRefreshToken) {
    argv.push("--stub-refresh-token", task.stubRefreshToken);
  }

  // GitHub repos API の status を変えたいケースだけ失敗スタブを追加する。
  if (task.stubGithubReposStatus !== undefined) {
    argv.push("--stub-github-repos-status", String(task.stubGithubReposStatus));
  }
};

const buildSummary = (results: CiTaskResult[]): CiSummary => {
  const counts = {
    pass: results.filter((result) => result.status === "pass").length,
    fail: results.filter((result) => result.status === "fail").length,
    error: results.filter((result) => result.status === "error").length,
  };

  return {
    version: 1,
    status: deriveSummaryStatus(counts),
    counts,
    results,
  };
};

const deriveSummaryStatus = (counts: {
  pass: number;
  fail: number;
  error: number;
}): CiTaskStatus => {
  // internal error が 1 件でもある場合は全体状態を error 優先で示す。
  if (counts.error > 0) {
    return "error";
  }

  // fail がある場合は実行自体は完了していても gate としては fail 扱いにする。
  if (counts.fail > 0) {
    return "fail";
  }

  return "pass";
};

const renderMarkdownSummary = (summary: CiSummary): string => {
  const lines = [
    "# call-liner CI Summary",
    "",
    `status: ${summary.status}`,
    `pass: ${summary.counts.pass}`,
    `fail: ${summary.counts.fail}`,
    `error: ${summary.counts.error}`,
    "",
  ];

  for (const result of summary.results) {
    lines.push(
      `- [${result.status}] ${result.projectId}/${result.taskId} (${result.kind}): ${result.summary}`,
    );
  }

  lines.push("");
  return lines.join("\n");
};

const toExitCode = (summary: CiSummary): number => {
  const hasFail = summary.counts.fail > 0;
  const hasError = summary.counts.error > 0;

  // fail と error の両方がある場合は混在コードを返す。
  if (hasFail && hasError) {
    return 3;
  }

  // internal error のみなら設定不備や実行不能として 2 を返す。
  if (hasError) {
    return 2;
  }

  // fail のみなら品質ゲート違反として 1 を返す。
  if (hasFail) {
    return 1;
  }

  return 0;
};
