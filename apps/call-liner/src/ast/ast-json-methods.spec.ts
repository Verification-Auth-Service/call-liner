import { describe, expect, it } from "vitest";
import AstMethods from "./ast-json-methods";
import { type AstJsonNode, programToAstJson } from "./program-to-ast-json";

const collectNodes = (node: AstJsonNode): AstJsonNode[] => {
  return [node, ...node.children.flatMap(collectNodes)];
};

describe("AstMethods", () => {
  it("returns node metadata and literal/type information", () => {
    const root = programToAstJson("const count = 1;", "sample.ts");
    const nodes = collectNodes(root);
    const identifier = nodes.find((node) => node.kind === "Identifier");
    const numericLiteral = nodes.find(
      (node) => node.kind === "FirstLiteralToken",
    );

    expect(AstMethods.getKind(root)).toBe("SourceFile");
    expect(AstMethods.getFileName(root)).toBe("sample.ts");
    expect(AstMethods.getUniqueId(root)).toBe(root.uniqueId);
    expect(AstMethods.getChildCount(root)).toBe(root.children.length);
    expect(AstMethods.getChild(root, 0)).toEqual(root.children[0]);

    expect(identifier).toBeDefined();
    expect(AstMethods.getText(identifier!)).toBe("count");
    expect(AstMethods.getType(identifier!)).toBe("1");

    expect(numericLiteral).toBeDefined();
    expect(AstMethods.getLiteralValue(numericLiteral!)).toBe(1);
    expect(AstMethods.getText(numericLiteral!)).toBe("1");
    expect(AstMethods.getType(numericLiteral!)).toBe("1");
  });

  it("returns null for out-of-range child indexes", () => {
    const root = programToAstJson("const value = 1;");

    expect(AstMethods.getChild(root, -1)).toBeNull();
    expect(
      AstMethods.getChild(root, AstMethods.getChildCount(root)),
    ).toBeNull();
  });
});
