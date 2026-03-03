import ts from "typescript";

export type AstJsonNode = {
  kind: string;
  pos: number;
  end: number;
  children: AstJsonNode[];
};

function toAstJsonNode(node: ts.Node): AstJsonNode {
  const children: AstJsonNode[] = [];
  node.forEachChild((child) => {
    children.push(toAstJsonNode(child));
  });

  return {
    kind: ts.SyntaxKind[node.kind],
    pos: node.pos,
    end: node.end,
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
  const sourceFile = ts.createSourceFile(
    fileName,
    programText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return toAstJsonNode(sourceFile);
}
