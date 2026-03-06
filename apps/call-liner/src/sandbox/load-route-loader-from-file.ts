import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { SandboxLoader } from "./phase1";

type RouteLoaderRuntimeDeps = {
  redirect: (url: string, init?: ResponseInit) => Response;
  getSession: (request: Request) => Promise<SessionLike> | SessionLike;
  commitSession: (
    session: SessionLike,
    options?: { maxAge?: number },
  ) => Promise<string> | string;
  globals?: Record<string, unknown>;
};

export type SessionLike = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
};

/**
 * ルートモジュール(ts/tsx)から export loader を読み出し、依存関数を注入した実行可能関数を返す。
 *
 * 入力例:
 * - routeModulePath: "/tmp/app/routes/auth+/github+/callback.tsx"
 * - runtimeDeps.redirect: (url) => new Response(null, { status: 302, headers: { Location: url } })
 * 出力例:
 * - ({ request }) => Promise<Response>
 */
export const loadRouteLoaderFromFile = async (
  routeModulePath: string,
  runtimeDeps: RouteLoaderRuntimeDeps,
): Promise<SandboxLoader> => {
  const sourceText = await readFile(routeModulePath, "utf8");
  const sanitizedSource = sanitizeRouteModuleSource(sourceText, routeModulePath);
  const transpiled = ts.transpileModule(sanitizedSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: routeModulePath,
  });

  const injectedGlobalNames = Object.keys(runtimeDeps.globals ?? {});
  const injectedGlobalValues = injectedGlobalNames.map(
    (name) => runtimeDeps.globals?.[name],
  );
  const loaderFactory = new Function(
    "redirect",
    "getSession",
    "commitSession",
    "process",
    "console",
    ...injectedGlobalNames,
    `${transpiled.outputText}
return typeof loader === "function" ? loader : undefined;`,
  ) as (
    redirect: RouteLoaderRuntimeDeps["redirect"],
    getSession: RouteLoaderRuntimeDeps["getSession"],
    commitSession: RouteLoaderRuntimeDeps["commitSession"],
    processRef: NodeJS.Process,
    consoleRef: Console,
    ...globals: unknown[]
  ) => unknown;

  const loaded = loaderFactory(
    runtimeDeps.redirect,
    runtimeDeps.getSession,
    runtimeDeps.commitSession,
    process,
    console,
    ...injectedGlobalValues,
  );

  // export loader が見つからないモジュールは実行対象にできないため明示エラーにする。
  if (typeof loaded !== "function") {
    throw new Error(
      `loader export was not found in route module: ${path.resolve(routeModulePath)}`,
    );
  }

  return loaded as SandboxLoader;
};

const sanitizeRouteModuleSource = (
  sourceText: string,
  routeModulePath: string,
): string => {
  const scriptKind = routeModulePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    routeModulePath,
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    scriptKind,
  );
  const transformed = ts.transform(sourceFile, [removeUnsupportedImportsAndExports]);
  const printer = ts.createPrinter();
  const transformedFile = transformed.transformed[0];
  const result = printer.printFile(transformedFile);
  transformed.dispose();
  return result;
};

const removeUnsupportedImportsAndExports: ts.TransformerFactory<ts.SourceFile> = (
  context,
) => {
  const visit: ts.Visitor = (node) => {
    // 依存解決をサンドボックス注入へ寄せるため、import 文は除去する。
    if (ts.isImportDeclaration(node)) {
      return undefined;
    }

    // re-export 文は loader 実行に不要なため除去する。
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
      return undefined;
    }

    // export 修飾を外して、関数評価後に loader 変数を直接参照できるようにする。
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isVariableStatement(node) ||
      ts.isClassDeclaration(node)
    ) {
      const modifiers = ts
        .getModifiers(node)
        ?.filter((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword);

      // export 修飾が無い場合は元ノードをそのまま返す。
      if (!modifiers || modifiers.length === ts.getModifiers(node)?.length) {
        return ts.visitEachChild(node, visit, context);
      }

      if (ts.isFunctionDeclaration(node)) {
        return ts.factory.updateFunctionDeclaration(
          node,
          modifiers,
          node.asteriskToken,
          node.name,
          node.typeParameters,
          node.parameters,
          node.type,
          node.body,
        );
      }

      if (ts.isVariableStatement(node)) {
        return ts.factory.updateVariableStatement(node, modifiers, node.declarationList);
      }

      return ts.factory.updateClassDeclaration(
        node,
        modifiers,
        node.name,
        node.typeParameters,
        node.heritageClauses,
        node.members,
      );
    }

    return ts.visitEachChild(node, visit, context);
  };

  return (sourceFile) => {
    const visited = ts.visitNode(sourceFile, visit);

    // TransformerFactory は SourceFile を返す契約のため、型が広がった場合は元値へ戻す。
    if (!visited || !ts.isSourceFile(visited)) {
      return sourceFile;
    }

    return visited;
  };
};
