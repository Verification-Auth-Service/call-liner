import ts from "typescript";
import { hashString } from "~/helper/hash";

export type AstJsonNode = {
  kind: string;
  pos: number;
  end: number;
  text?: string;
  literalValue?: string | number | boolean | null;
  type?: string;
  symbolName?: string;
  resolvedSymbolName?: string;
  symbolResolution?: SymbolResolutionInfo;
  symbolResolutionHash?: string;
  symbolResolutionByHash?: Record<string, SymbolResolutionInfo>;
  declarationFileName?: string;
  declarationPos?: number;
  children: AstJsonNode[];
  uniqueId: string;
  fileName: string;
};

export type SymbolResolutionPathStep = {
  // lookup: シンボルテーブルからの名前解決、
  // resolveAlias: エイリアス解決、
  // declaration: 宣言位置特定
  phase: "lookup" | "resolveAlias" | "declaration";
  symbolName: string;
  declarationFileName?: string;
  declarationPos?: number;
};

export type SymbolResolutionInfo = {
  hash: string;
  path: SymbolResolutionPathStep[];
};

function toLiteralValue(
  node: ts.Node,
): string | number | boolean | null | undefined {
  // 数値リテラルは JSON 側で比較・集計しやすいよう number として保持する。
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }

  // 文字列系リテラルは展開後の text を保持し、元コードの引用符は含めない。
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }

  // true/false/null はキーワードノードとして現れるため kind で分岐する。
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }

  return undefined;
}

function toNodeType(
  node: ts.Node,
  checker: ts.TypeChecker,
): string | undefined {
  try {
    const type = checker.getTypeAtLocation(node);
    return checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation);
  } catch {
    // 型取得不可ノードは report 生成を止めず、型情報なしで継続する。
    return undefined;
  }
}

function toSymbolInfo(
  node: ts.Node,
  checker: ts.TypeChecker,
):
  | {
      symbolName?: string;
      resolvedSymbolName?: string;
      symbolResolution?: SymbolResolutionInfo;
      declarationFileName?: string;
      declarationPos?: number;
    }
  | undefined {
  // 識別子以外はシンボル解決対象ではないため早期終了する。
  if (!ts.isIdentifier(node)) {
    return undefined;
  }

  try {
    const symbol = checker.getSymbolAtLocation(node);

    // 未解決識別子は情報を持たないノードとして扱う。
    if (!symbol) {
      return undefined;
    }

    const resolvedSymbol =
      // import alias は実体シンボルへ辿ってから宣言位置を記録する。
      symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
    const declaration = resolvedSymbol.declarations?.[0];
    const symbolResolutionPath: SymbolResolutionPathStep[] = [
      {
        phase: "lookup",
        symbolName: symbol.getName(),
      },
    ];

    // alias でない識別子は lookup のみで解決されるため、別フェーズは追加しない。
    if (symbol.flags & ts.SymbolFlags.Alias) {
      symbolResolutionPath.push({
        phase: "resolveAlias",
        symbolName: resolvedSymbol.getName(),
      });
    }

    // 宣言位置が取れる場合のみ declaration フェーズを追加して経路を明示する。
    if (declaration) {
      symbolResolutionPath.push({
        phase: "declaration",
        symbolName: resolvedSymbol.getName(),
        declarationFileName: declaration.getSourceFile().fileName,
        declarationPos: declaration.pos,
      });
    }
    const symbolResolution = {
      hash: hashString(JSON.stringify(symbolResolutionPath)),
      path: symbolResolutionPath,
    };

    return {
      symbolName: symbol.getName(),
      resolvedSymbolName: resolvedSymbol.getName(),
      symbolResolution,
      declarationFileName: declaration?.getSourceFile().fileName,
      declarationPos: declaration?.pos,
    };
  } catch {
    // シンボル取得不可ノードは report 生成を止めず、シンボル情報なしで継続する。
    return undefined;
  }
}

function toAstJsonNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): AstJsonNode {
  const children: AstJsonNode[] = [];
  node.forEachChild((child) => {
    children.push(toAstJsonNode(child, sourceFile, checker));
  });

  const literalValue = toLiteralValue(node);
  const type = toNodeType(node, checker);
  const symbolInfo = toSymbolInfo(node, checker);
  const text = children.length === 0 ? node.getText(sourceFile) : undefined;

  return {
    kind: ts.SyntaxKind[node.kind],
    pos: node.pos,
    end: node.end,
    text,
    literalValue,
    type,
    symbolName: symbolInfo?.symbolName,
    resolvedSymbolName: symbolInfo?.resolvedSymbolName,
    symbolResolution: symbolInfo?.symbolResolution,
    declarationFileName: symbolInfo?.declarationFileName,
    declarationPos: symbolInfo?.declarationPos,
    children,
    uniqueId: (() => {
      // kind/pos/end/fileName でhash化
      const baseString = `${ts.SyntaxKind[node.kind]}-${node.pos}-${node.end}-${sourceFile.fileName}`;
      return hashString(baseString);
    })(),
    fileName: sourceFile.fileName,
  };
}

function collectSymbolResolutionUsage(
  root: AstJsonNode,
): Map<string, { count: number; info: SymbolResolutionInfo }> {
  const usageByHash = new Map<
    string,
    { count: number; info: SymbolResolutionInfo }
  >();
  const nodes = [root];

  while (nodes.length > 0) {
    const current = nodes.pop();

    // pop の戻り値は undefined の可能性があるため安全側でスキップする。
    if (!current) {
      continue;
    }

    const resolution = current.symbolResolution;

    // シンボル解決情報を持たないノードは集計対象外。
    if (resolution) {
      const existing = usageByHash.get(resolution.hash);

      // 初出ハッシュは count=1 で追加し、同値情報への参照を保持する。
      if (!existing) {
        usageByHash.set(resolution.hash, {
          count: 1,
          info: resolution,
        });
      } else {
        existing.count += 1;
      }
    }

    nodes.push(...current.children);
  }

  return usageByHash;
}

function optimizeSymbolResolutionStorage(root: AstJsonNode): AstJsonNode {
  const usageByHash = collectSymbolResolutionUsage(root);
  const sharedInfoByHash: Record<string, SymbolResolutionInfo> = {};
  const nodes = [root];

  while (nodes.length > 0) {
    const current = nodes.pop();

    // pop の戻り値は undefined の可能性があるため安全側でスキップする。
    if (!current) {
      continue;
    }

    const resolution = current.symbolResolution;

    // 解決情報を持たないノードは変換不要。
    if (resolution) {
      const usage = usageByHash.get(resolution.hash);

      // 使用回数 1 の情報はノード直下に残して読みやすさを優先する。
      if (usage && usage.count === 1) {
        current.symbolResolutionHash = undefined;
      } else if (usage) {
        // 複数利用情報は root 側ハッシュ辞書へ集約し、ノードは hash 参照のみ保持する。
        sharedInfoByHash[resolution.hash] = usage.info;
        current.symbolResolutionHash = resolution.hash;
        current.symbolResolution = undefined;
      }
    }

    nodes.push(...current.children);
  }

  // 共有対象がある場合のみ root に辞書を付与し、JSON ノイズを増やさない。
  if (Object.keys(sharedInfoByHash).length > 0) {
    root.symbolResolutionByHash = sharedInfoByHash;
  }

  return root;
}

/**
 * TypeScript の SourceFile と TypeChecker から AST の木構造 JSON に変換する。
 *
 * 入力例:
 * - sourceFile: program.getSourceFile("/work/src/main.ts")
 * - checker: program.getTypeChecker()
 *
 * 出力例:
 * - { kind: "SourceFile", children: [{ kind: "ImportDeclaration", ... }], ... }
 */
export function sourceFileToAstJson(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): AstJsonNode {
  return optimizeSymbolResolutionStorage(
    toAstJsonNode(sourceFile, sourceFile, checker),
  );
}

/**
 * TypeScript のプログラム文字列を AST の木構造 JSON に変換する。
 *
 * 入力例:
 * - programText: "const x = 1;"
 * - fileName: "input.ts"
 *
 * 出力例:
 * - { kind: "SourceFile", children: [{ kind: "FirstStatement", ... }], ... }
 */
export function programToAstJson(
  programText: string,
  fileName = "input.ts",
): AstJsonNode {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    skipLibCheck: true,
  };
  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const inMemorySourceFile = ts.createSourceFile(
    fileName,
    programText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile: (
      requestedFileName,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    ) => {
      // 解析対象ファイルは常に引数のプログラム文字列を使い、ディスク内容との差異を排除する。
      if (requestedFileName === fileName) {
        return inMemorySourceFile;
      }

      return defaultHost.getSourceFile(
        requestedFileName,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
    },
    readFile: (requestedFileName) => {
      // 型付け時に対象ファイルを再読込する場合も in-memory の内容を返す。
      if (requestedFileName === fileName) {
        return programText;
      }

      return defaultHost.readFile(requestedFileName);
    },
    fileExists: (requestedFileName) => {
      // 対象ファイルは必ず存在扱いにして Program 構築を安定させる。
      if (requestedFileName === fileName) {
        return true;
      }

      return defaultHost.fileExists(requestedFileName);
    },
  };
  const program = ts.createProgram([fileName], compilerOptions, host);
  const sourceFile = program.getSourceFile(fileName) ?? inMemorySourceFile;
  const checker = program.getTypeChecker();

  return sourceFileToAstJson(sourceFile, checker);
}
