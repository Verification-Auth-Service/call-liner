import ts from "typescript";

export type AstJsonNode = {
  kind: string;
  pos: number;
  end: number;
  text?: string;
  literalValue?: string | number | boolean | null;
  type?: string;
  children: AstJsonNode[];
};

function toLiteralValue(node: ts.Node): string | number | boolean | null | undefined {
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

function toNodeType(node: ts.Node, checker: ts.TypeChecker): string | undefined {
  try {
    const type = checker.getTypeAtLocation(node);
    return checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation);
  } catch {
    // 型取得不可ノードは report 生成を止めず、型情報なしで継続する。
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
  const text = children.length === 0 ? node.getText(sourceFile) : undefined;

  return {
    kind: ts.SyntaxKind[node.kind],
    pos: node.pos,
    end: node.end,
    text,
    literalValue,
    type,
    children,
  };
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
    getSourceFile: (requestedFileName, languageVersion, onError, shouldCreateNewSourceFile) => {
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

  return toAstJsonNode(sourceFile, sourceFile, checker);
}
