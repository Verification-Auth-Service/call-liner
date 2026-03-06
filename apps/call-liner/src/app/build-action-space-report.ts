import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { EnumeratedRoute } from "../framework/framework-entry-strategy";
import type { EntryAstJsonReport } from "./process-entry-ast-json";

export type EntryPointKind =
  | "authorize_start"
  | "callback"
  | "resource_access"
  | "unknown";

export type GuardTag =
  | "missing_input"
  | "mismatch_validation"
  | "missing_runtime_secret"
  | "session_absent"
  | "token_absent"
  | "unknown_guard";

export type ExternalIoType =
  | "redirect"
  | "fetch"
  | "db"
  | "session_read"
  | "session_write"
  | "cookie_commit";

export type ActionType =
  | "guard_true"
  | "guard_false"
  | "trigger_redirect"
  | "trigger_token_exchange"
  | "trigger_resource_fetch"
  | "trigger_db_write"
  | "trigger_db_read"
  | "trigger_session_read"
  | "trigger_session_write"
  | "trigger_cookie_commit";

export type ActionSpaceEntrypoint = {
  id: string;
  entryType: string;
  sourcePath: string;
  routeId?: string;
  routePath?: string;
  handlerName: "loader" | "action";
  endpointKinds: EntryPointKind[];
};

export type ActionSpaceGuard = {
  id: string;
  entrypointId: string;
  condition: string;
  line: number;
  tags: GuardTag[];
};

export type ActionSpaceExternalIo = {
  id: string;
  entrypointId: string;
  ioType: ExternalIoType;
  line: number;
  detail: Record<string, string | number | boolean | undefined>;
};

export type ActionSpaceAction = {
  id: string;
  entrypointId: string;
  type: ActionType;
  label: string;
};

export type ActionSpaceEdge = {
  id: string;
  actionId: string;
  targetType: "guard" | "external_io";
  targetId: string;
  relation: "evaluates" | "triggers";
};

export type ActionSpaceReport = {
  version: 1;
  generatedAt: string;
  summary: {
    entrypoints: number;
    guards: number;
    externalIo: number;
    actions: number;
    edges: number;
  };
  entrypoints: ActionSpaceEntrypoint[];
  guards: ActionSpaceGuard[];
  externalIo: ActionSpaceExternalIo[];
  actions: ActionSpaceAction[];
  edges: ActionSpaceEdge[];
};

type BuildActionSpaceOptions = {
  reports: EntryAstJsonReport[];
  routesByEntry: Record<string, EnumeratedRoute[]>;
  generatedAt?: string;
};

type ExtractedGuard = {
  condition: string;
  line: number;
  tags: GuardTag[];
};

type ExtractedExternalIo = {
  ioType: ExternalIoType;
  line: number;
  detail: Record<string, string | number | boolean | undefined>;
};

type HandlerSignals = {
  hasAuthorizeRedirect: boolean;
  hasCodeAndStateInput: boolean;
  hasTokenExchangeFetch: boolean;
  hasBearerUsage: boolean;
  hasResourceFetch: boolean;
};

type HandlerExtraction = {
  guards: ExtractedGuard[];
  externalIo: ExtractedExternalIo[];
  signals: HandlerSignals;
};

type RouteMetadata = {
  routeId?: string;
  routePath?: string;
};

type ExportedHandler = {
  name: "loader" | "action";
  body: ts.Block;
};

const DB_WRITE_METHODS = new Set([
  "upsert",
  "create",
  "createMany",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

const DB_READ_METHODS = new Set([
  "findUnique",
  "findFirst",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

const SESSION_READ_METHODS = new Set(["get"]);
const SESSION_WRITE_METHODS = new Set(["set", "unset", "flash"]);

function normalizeText(text: string): string {
  return text.replace(/\s+/g, "");
}

function toLineNumber(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function toScriptKind(filePath: string): ts.ScriptKind {
  const extension = path.extname(filePath).toLowerCase();

  // 拡張子ごとに script kind を指定し、TSX/JSX の誤解析を防ぐ。
  switch (extension) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
      return ts.ScriptKind.JS;
    case ".mjs":
      return ts.ScriptKind.JS;
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = (node as ts.HasModifiers).modifiers;

  // modifiers が無いノードは export 判定できないため false を返す。
  if (!modifiers) {
    return false;
  }

  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function toCalleeName(callExpression: ts.CallExpression): string | undefined {
  const expression = callExpression.expression;

  // `fn()` 形式は識別子名をそのまま返す。
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  // `obj.fn()` 形式は末尾のプロパティ名を返す。
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return undefined;
}

function toExpressionText(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): string | undefined {
  // 引数が無いケースは情報を作れないため undefined を返す。
  if (!expression) {
    return undefined;
  }

  // 文字列リテラルは引用符を除いた値を使う。
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }

  return expression.getText(sourceFile);
}

function isSessionVariableExpression(
  expression: ts.Expression,
  sessionVariableNames: Set<string>,
): boolean {
  // `session.get(...)` のような識別子アクセスのみをセッション呼び出し候補にする。
  if (!ts.isIdentifier(expression)) {
    return false;
  }

  return sessionVariableNames.has(expression.text);
}

function pushUniqueTag(target: GuardTag[], tag: GuardTag): void {
  // 同一タグの重複は分類ノイズになるため初回だけ追加する。
  if (!target.includes(tag)) {
    target.push(tag);
  }
}

function classifyGuardTags(conditionText: string): GuardTag[] {
  const normalized = normalizeText(conditionText);
  const result: GuardTag[] = [];

  // code/state/verifier などの欠落判定は入力不足ガードとして扱う。
  if (
    normalized.includes("!code") ||
    normalized.includes("!state") ||
    normalized.includes("!verifier") ||
    normalized.includes("!accessToken") ||
    normalized.includes("!refreshToken") ||
    normalized.includes("typeofverifier!==\"string\"") ||
    normalized.includes("typeofverifier!=='string'") ||
    normalized.includes("typeofaccessToken!==\"string\"") ||
    normalized.includes("typeofaccessToken!=='string'")
  ) {
    pushUniqueTag(result, "missing_input");
  }

  // 一致比較の失敗は改ざん・不整合の検証として扱う。
  if (
    (normalized.includes("!==") || normalized.includes("!=")) &&
    (normalized.includes("state") ||
      normalized.includes("savedState") ||
      normalized.includes("verifier"))
  ) {
    pushUniqueTag(result, "mismatch_validation");
  }

  // clientId/clientSecret/env 依存の条件は実行環境設定不足として扱う。
  if (
    normalized.includes("clientSecret") ||
    normalized.includes("clientId") ||
    normalized.includes("process.env") ||
    normalized.includes("getResourceClientSecret") ||
    normalized.includes("getResourceClientId")
  ) {
    pushUniqueTag(result, "missing_runtime_secret");
  }

  // セッション読み取り値への依存条件は session_absent タグを付与する。
  if (
    normalized.includes("savedState") ||
    normalized.includes("session.get") ||
    normalized.includes("oauth:") ||
    normalized.includes("verifier")
  ) {
    pushUniqueTag(result, "session_absent");
  }

  // トークン変数に対する欠落判定は token_absent タグとして扱う。
  if (normalized.includes("accessToken") || normalized.includes("refreshToken")) {
    pushUniqueTag(result, "token_absent");
  }

  // 既知分類に当てはまらない条件でも抽出を欠落させないため unknown を付ける。
  if (result.length === 0) {
    result.push("unknown_guard");
  }

  return result;
}

function isTokenEndpointDestination(destination: string): boolean {
  const normalized = destination.toLowerCase();

  return (
    normalized.includes("login/oauth/access_token") ||
    normalized.includes("/oauth/token") ||
    normalized.includes("tokenurl") ||
    normalized.includes("getresourcetokenurl")
  );
}

function isResourceApiDestination(destination: string): boolean {
  const normalized = destination.toLowerCase();

  return (
    normalized.includes("api.github.com/user") ||
    normalized.includes("getresourceprotectedapiurl")
  );
}

function isAuthorizeRedirectDestination(destination: string): boolean {
  const normalized = destination.toLowerCase();

  return (
    normalized.includes("authorize") ||
    normalized.includes("github.com/login/oauth/authorize")
  );
}

function extractSessionVariableNames(handlerBody: ts.Block): Set<string> {
  const sessionVariableNames = new Set<string>(["session"]);

  const visit = (node: ts.Node): void => {
    // getSession(...) の戻り値を受ける識別子をセッション変数として記録する。
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = node.initializer;

      if (ts.isAwaitExpression(initializer) && ts.isCallExpression(initializer.expression)) {
        const calleeName = toCalleeName(initializer.expression);

        // `await getSession(request)` のパターンだけを session 変数として採用する。
        if (calleeName === "getSession") {
          sessionVariableNames.add(node.name.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(handlerBody);
  return sessionVariableNames;
}

function collectExportedHandlers(sourceFile: ts.SourceFile): ExportedHandler[] {
  const handlers: ExportedHandler[] = [];

  for (const statement of sourceFile.statements) {
    // `export async function loader(...) {}` をハンドラとして抽出する。
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      const functionName = statement.name?.text;

      // loader/action 以外の公開関数は本フェーズの対象外とする。
      if (
        (functionName === "loader" || functionName === "action") &&
        statement.body
      ) {
        handlers.push({
          name: functionName,
          body: statement.body,
        });
      }
      continue;
    }

    // `export const loader = async () => {}` 形式にも対応する。
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        // 識別子名を取れない宣言は loader/action 判定できないため除外する。
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }

        const declarationName = declaration.name.text;
        const initializer = declaration.initializer;

        // 初期化子が無い宣言は実体の関数本体がないため除外する。
        if (!initializer) {
          continue;
        }

        const isTargetHandler = declarationName === "loader" || declarationName === "action";

        // loader/action 以外の公開変数は本フェーズの対象外とする。
        if (!isTargetHandler) {
          continue;
        }

        // 関数式・アロー関数の両方をハンドラ候補として受け付ける。
        if (
          ts.isArrowFunction(initializer) ||
          ts.isFunctionExpression(initializer)
        ) {
          // ブロック本体でない式本体は if/call 解析が困難なため除外する。
          if (!ts.isBlock(initializer.body)) {
            continue;
          }

          handlers.push({
            name: declarationName,
            body: initializer.body,
          });
        }
      }
    }
  }

  return handlers;
}

function extractMaxAgeFromCommitSessionCall(
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
): string | undefined {
  const optionsArgument = callExpression.arguments[1];

  // 第2引数が無い場合は maxAge 指定が存在しないため undefined を返す。
  if (!optionsArgument) {
    return undefined;
  }

  // Object literal 以外は maxAge キーを静的抽出できないため undefined を返す。
  if (!ts.isObjectLiteralExpression(optionsArgument)) {
    return undefined;
  }

  for (const property of optionsArgument.properties) {
    // プロパティ名が識別できない場合は maxAge 判定できないためスキップする。
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const propertyName = property.name.getText(sourceFile);

    // maxAge 以外のキーは cookie 寿命抽出対象外としてスキップする。
    if (propertyName !== "maxAge") {
      continue;
    }

    return property.initializer.getText(sourceFile);
  }

  return undefined;
}

function createRouteMetadataIndex(
  routesByEntry: Record<string, EnumeratedRoute[]>,
): Map<string, RouteMetadata> {
  const index = new Map<string, RouteMetadata>();

  for (const routes of Object.values(routesByEntry)) {
    for (const route of routes) {
      index.set(route.sourcePath, {
        routeId: route.routeId,
        routePath: route.routePath,
      });
    }
  }

  return index;
}

function classifyEntrypointKinds(
  routeMetadata: RouteMetadata | undefined,
  signals: HandlerSignals,
): EntryPointKind[] {
  const result: EntryPointKind[] = [];
  const routePath = routeMetadata?.routePath ?? "";
  const normalizedRoutePath = routePath.toLowerCase();

  // authorize 用 redirect が見える場合は開始エンドポイントとして分類する。
  if (signals.hasAuthorizeRedirect) {
    result.push("authorize_start");
  }

  // code/state 入力と token exchange の組み合わせは callback として扱う。
  if (
    signals.hasCodeAndStateInput &&
    (signals.hasTokenExchangeFetch || normalizedRoutePath.includes("callback"))
  ) {
    result.push("callback");
  }

  // Bearer 利用または保護 API fetch がある場合は resource_access とみなす。
  if (signals.hasBearerUsage || signals.hasResourceFetch) {
    result.push("resource_access");
  }

  // どのシグナルにも該当しない場合でもエントリを欠落させないため unknown を付与する。
  if (result.length === 0) {
    result.push("unknown");
  }

  return result;
}

function extractHandlerSignalsAndIo(
  sourceFile: ts.SourceFile,
  handlerBody: ts.Block,
): HandlerExtraction {
  const guards: ExtractedGuard[] = [];
  const externalIo: ExtractedExternalIo[] = [];
  const sessionVariableNames = extractSessionVariableNames(handlerBody);
  const signals: HandlerSignals = {
    hasAuthorizeRedirect: false,
    hasCodeAndStateInput: false,
    hasTokenExchangeFetch: false,
    hasBearerUsage: false,
    hasResourceFetch: false,
  };

  const visit = (node: ts.Node): void => {
    // if 条件は攻撃入口候補の中心なので、条件文字列と分類タグを抽出する。
    if (ts.isIfStatement(node)) {
      const condition = node.expression.getText(sourceFile);
      guards.push({
        condition,
        line: toLineNumber(sourceFile, node.expression),
        tags: classifyGuardTags(condition),
      });
    }

    // call expression は外部I/Oと入力読取の主要な検出点なので個別に解析する。
    if (ts.isCallExpression(node)) {
      const calleeName = toCalleeName(node);

      // redirect は authorize 開始やエラーハンドリング分岐の副作用として記録する。
      if (calleeName === "redirect") {
        const destination = toExpressionText(node.arguments[0], sourceFile);
        externalIo.push({
          ioType: "redirect",
          line: toLineNumber(sourceFile, node),
          detail: {
            destination,
          },
        });

        // authorize 文字列があれば authorize 開始シグナルとして扱う。
        if (destination && isAuthorizeRedirectDestination(destination)) {
          signals.hasAuthorizeRedirect = true;
        }
      }

      // fetch は token endpoint / resource API の境界点として記録する。
      if (calleeName === "fetch") {
        const destination = toExpressionText(node.arguments[0], sourceFile) ?? "unknown";
        const requestInit = toExpressionText(node.arguments[1], sourceFile) ?? "";
        const tokenEndpoint = isTokenEndpointDestination(destination);
        const resourceApi = isResourceApiDestination(destination);
        const hasBearer = requestInit.includes("Bearer");

        externalIo.push({
          ioType: "fetch",
          line: toLineNumber(sourceFile, node),
          detail: {
            destination,
            tokenEndpoint,
            resourceApi,
            hasBearer,
          },
        });

        // token endpoint への通信は callback のトークン交換シグナルとみなす。
        if (tokenEndpoint) {
          signals.hasTokenExchangeFetch = true;
        }

        // Bearer 利用は resource access 判定シグナルとして扱う。
        if (hasBearer) {
          signals.hasBearerUsage = true;
        }

        // 保護 API 向け通信は resource access 判定シグナルとして扱う。
        if (resourceApi) {
          signals.hasResourceFetch = true;
        }
      }

      // `url.searchParams.get("code")` / `get("state")` は callback 入力読取として扱う。
      if (calleeName === "get" && node.arguments.length > 0) {
        const firstArgument = node.arguments[0];
        const keyName = toExpressionText(firstArgument, sourceFile);

        if (ts.isPropertyAccessExpression(node.expression)) {
          const ownerText = node.expression.expression.getText(sourceFile);

          // searchParams 経由の code/state 参照は callback 入力シグナルとして記録する。
          if (
            ownerText.endsWith(".searchParams") &&
            (keyName === "code" || keyName === "state")
          ) {
            signals.hasCodeAndStateInput = true;
          }
        }
      }

      // commitSession は Set-Cookie の寿命指定を抽出する。
      if (calleeName === "commitSession") {
        externalIo.push({
          ioType: "cookie_commit",
          line: toLineNumber(sourceFile, node),
          detail: {
            maxAge: extractMaxAgeFromCommitSessionCall(node, sourceFile),
          },
        });
      }

      // session の get/set/unset/flash はセッション境界として読み書き別に抽出する。
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        isSessionVariableExpression(node.expression.expression, sessionVariableNames)
      ) {
        const methodName = node.expression.name.text;
        const keyName = toExpressionText(node.arguments[0], sourceFile);

        if (SESSION_READ_METHODS.has(methodName)) {
          externalIo.push({
            ioType: "session_read",
            line: toLineNumber(sourceFile, node),
            detail: {
              method: methodName,
              key: keyName,
            },
          });
        }

        if (SESSION_WRITE_METHODS.has(methodName)) {
          externalIo.push({
            ioType: "session_write",
            line: toLineNumber(sourceFile, node),
            detail: {
              method: methodName,
              key: keyName,
            },
          });
        }
      }

      // Prisma などの `*.upsert()` は DB操作として抽出する。
      if (ts.isPropertyAccessExpression(node.expression)) {
        const operation = node.expression.name.text;

        if (DB_WRITE_METHODS.has(operation) || DB_READ_METHODS.has(operation)) {
          externalIo.push({
            ioType: "db",
            line: toLineNumber(sourceFile, node),
            detail: {
              operation,
              target: node.expression.expression.getText(sourceFile),
              operationKind: DB_WRITE_METHODS.has(operation) ? "write" : "read",
            },
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(handlerBody);
  return { guards, externalIo, signals };
}

function toActionTypeFromExternalIo(externalIo: ExtractedExternalIo): ActionType {
  // redirect は認可開始/画面遷移に直接影響するため専用 action に割り当てる。
  if (externalIo.ioType === "redirect") {
    return "trigger_redirect";
  }

  // fetch は token endpoint とそれ以外で攻撃観点が異なるため分岐する。
  if (externalIo.ioType === "fetch") {
    if (externalIo.detail.tokenEndpoint) {
      return "trigger_token_exchange";
    }

    return "trigger_resource_fetch";
  }

  // DB は読み書きで副作用の重さが違うため分けて action 化する。
  if (externalIo.ioType === "db") {
    if (externalIo.detail.operationKind === "write") {
      return "trigger_db_write";
    }

    return "trigger_db_read";
  }

  // session の read はトークン漏えい/存在確認面の操作に対応させる。
  if (externalIo.ioType === "session_read") {
    return "trigger_session_read";
  }

  // session の write は state/token の改変面の操作に対応させる。
  if (externalIo.ioType === "session_write") {
    return "trigger_session_write";
  }

  return "trigger_cookie_commit";
}

function toIdFactory() {
  let sequence = 0;

  return (prefix: string): string => {
    sequence += 1;
    return `${prefix}-${sequence}`;
  };
}

/**
 * AST 収集済みレポート群から、フェーズA向けの action-space JSON を生成する。
 *
 * 入力例:
 * - {
 *     reports: [{ entryType: "client", sourcePath: "/tmp/app/routes/auth+/github+/callback.tsx", reportRelativePath: "app/routes/auth+/github+/callback.tsx.json", astTree: {...} }],
 *     routesByEntry: { client: [{ sourcePath: "/tmp/app/routes/auth+/github+/callback.tsx", routeId: "auth+/github+/callback", routePath: "/auth/github/callback" }] }
 *   }
 *
 * 出力例:
 * - {
 *     version: 1,
 *     generatedAt: "...",
 *     summary: { entrypoints: 1, guards: 3, externalIo: 8, actions: 14, edges: 14 },
 *     entrypoints: [...],
 *     guards: [...],
 *     externalIo: [...],
 *     actions: [...],
 *     edges: [...]
 *   }
 */
export async function buildActionSpaceReport(
  options: BuildActionSpaceOptions,
): Promise<ActionSpaceReport> {
  const nextId = toIdFactory();
  const routeMetadataBySourcePath = createRouteMetadataIndex(options.routesByEntry);
  const entrypoints: ActionSpaceEntrypoint[] = [];
  const guards: ActionSpaceGuard[] = [];
  const externalIo: ActionSpaceExternalIo[] = [];
  const actions: ActionSpaceAction[] = [];
  const edges: ActionSpaceEdge[] = [];

  for (const report of options.reports) {
    const sourceText = await readFile(report.sourcePath, "utf8");
    const sourceFile = ts.createSourceFile(
      report.sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      toScriptKind(report.sourcePath),
    );
    const handlers = collectExportedHandlers(sourceFile);

    for (const handler of handlers) {
      const routeMetadata = routeMetadataBySourcePath.get(report.sourcePath);
      const handlerExtraction = extractHandlerSignalsAndIo(sourceFile, handler.body);
      const entrypointId = nextId("entrypoint");
      entrypoints.push({
        id: entrypointId,
        entryType: report.entryType,
        sourcePath: report.sourcePath,
        routeId: routeMetadata?.routeId,
        routePath: routeMetadata?.routePath,
        handlerName: handler.name,
        endpointKinds: classifyEntrypointKinds(routeMetadata, handlerExtraction.signals),
      });

      for (const guard of handlerExtraction.guards) {
        const guardId = nextId("guard");
        guards.push({
          id: guardId,
          entrypointId,
          condition: guard.condition,
          line: guard.line,
          tags: guard.tags,
        });

        const trueActionId = nextId("action");
        actions.push({
          id: trueActionId,
          entrypointId,
          type: "guard_true",
          label: `if(${guard.condition}) の true 分岐`,
        });
        edges.push({
          id: nextId("edge"),
          actionId: trueActionId,
          targetType: "guard",
          targetId: guardId,
          relation: "evaluates",
        });

        const falseActionId = nextId("action");
        actions.push({
          id: falseActionId,
          entrypointId,
          type: "guard_false",
          label: `if(${guard.condition}) の false 分岐`,
        });
        edges.push({
          id: nextId("edge"),
          actionId: falseActionId,
          targetType: "guard",
          targetId: guardId,
          relation: "evaluates",
        });
      }

      for (const extractedIo of handlerExtraction.externalIo) {
        const ioId = nextId("external-io");
        externalIo.push({
          id: ioId,
          entrypointId,
          ioType: extractedIo.ioType,
          line: extractedIo.line,
          detail: extractedIo.detail,
        });

        const actionId = nextId("action");
        actions.push({
          id: actionId,
          entrypointId,
          type: toActionTypeFromExternalIo(extractedIo),
          label: `${extractedIo.ioType} の副作用を発火`,
        });
        edges.push({
          id: nextId("edge"),
          actionId,
          targetType: "external_io",
          targetId: ioId,
          relation: "triggers",
        });
      }
    }
  }

  return {
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    summary: {
      entrypoints: entrypoints.length,
      guards: guards.length,
      externalIo: externalIo.length,
      actions: actions.length,
      edges: edges.length,
    },
    entrypoints,
    guards,
    externalIo,
    actions,
    edges,
  };
}
