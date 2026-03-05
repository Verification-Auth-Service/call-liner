import { describe, expect, it } from "vitest";
import ASTJsonMethods from "./ast-json-methods";
import {
  type AstJsonNode,
  programToAstJson,
} from "./program-to-ast-json";

const collectNodes = (node: AstJsonNode): AstJsonNode[] => {
  return [node, ...node.children.flatMap(collectNodes)];
};

describe("ASTJsonMethods", () => {
  it("returns node metadata and literal/type information", () => {
    const root = programToAstJson("const count = 1;", "sample.ts");
    const nodes = collectNodes(root);
    const identifier = nodes.find((node) => node.kind === "Identifier");
    const numericLiteral = nodes.find(
      (node) => node.kind === "FirstLiteralToken",
    );

    expect(ASTJsonMethods.getKind(root)).toBe("SourceFile");
    expect(ASTJsonMethods.getFileName(root)).toBe("sample.ts");
    expect(ASTJsonMethods.getUniqueId(root)).toBe(root.uniqueId);
    expect(ASTJsonMethods.getChildCount(root)).toBe(root.children.length);
    expect(ASTJsonMethods.getChild(root, 0)).toEqual(root.children[0]);

    expect(identifier).toBeDefined();
    expect(ASTJsonMethods.getText(identifier!)).toBe("count");
    expect(ASTJsonMethods.getType(identifier!)).toBe("1");

    expect(numericLiteral).toBeDefined();
    expect(ASTJsonMethods.getLiteralValue(numericLiteral!)).toBe(1);
    expect(ASTJsonMethods.getText(numericLiteral!)).toBe("1");
    expect(ASTJsonMethods.getType(numericLiteral!)).toBe("1");
  });

  it("returns null for out-of-range child indexes", () => {
    const root = programToAstJson("const value = 1;");

    expect(ASTJsonMethods.getChild(root, -1)).toBeNull();
    expect(ASTJsonMethods.getChild(root, ASTJsonMethods.getChildCount(root))).toBeNull();
  });
});
