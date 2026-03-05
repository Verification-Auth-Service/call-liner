import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

  it("resolves aliased import symbols to declarations in another file", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "call-liner-"));

    try {
      const libPath = path.join(tempRoot, "lib.ts");
      const mainPath = path.join(tempRoot, "main.ts");
      await writeFile(libPath, "export const x = 10;", "utf8");
      const root = programToAstJson(
        'import { x as importedX } from "./lib";\nconsole.log(importedX);',
        mainPath,
      );
      const nodes = collectNodes(root);
      const importedIdentifier = nodes.find(
        (node) => node.kind === "Identifier" && node.text === "importedX",
      );

      expect(importedIdentifier).toBeDefined();
      expect(AstMethods.getSymbolName(importedIdentifier!)).toBe("importedX");
      expect(AstMethods.getResolvedSymbolName(importedIdentifier!)).toBe("x");
      expect(AstMethods.getDeclarationFileName(importedIdentifier!)).toBe(
        libPath,
      );
      expect(AstMethods.getDeclarationPos(importedIdentifier!)).toBeTypeOf(
        "number",
      );
      expect(AstMethods.getSymbolResolution(importedIdentifier!)).toBeUndefined();
      expect(AstMethods.getSymbolResolutionHash(importedIdentifier!)).toBeTypeOf(
        "string",
      );
      const sharedResolutions = AstMethods.getSymbolResolutionByHash(root);
      expect(sharedResolutions).toBeDefined();
      expect(
        sharedResolutions?.[
          AstMethods.getSymbolResolutionHash(importedIdentifier!) as string
        ]?.path.some((step) => step.phase === "resolveAlias"),
      ).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("stores symbol resolution path inline when only used once", () => {
    const root = programToAstJson("const value = 1;");
    const nodes = collectNodes(root);
    const declarationIdentifier = nodes.find(
      (node) => node.kind === "Identifier" && node.text === "value",
    );

    expect(declarationIdentifier).toBeDefined();
    expect(
      AstMethods.getSymbolResolution(declarationIdentifier!)?.path[0]?.phase,
    ).toBe("lookup");
    expect(AstMethods.getSymbolResolutionHash(declarationIdentifier!)).toBeUndefined();
  });

  it("returns undefined symbol metadata when identifier cannot be resolved", () => {
    const root = programToAstJson("console.log(missingValue);", "sample.ts");
    const nodes = collectNodes(root);
    const unresolvedIdentifier = nodes.find(
      (node) => node.kind === "Identifier" && node.text === "missingValue",
    );

    expect(unresolvedIdentifier).toBeDefined();
    expect(AstMethods.getSymbolName(unresolvedIdentifier!)).toBeUndefined();
    expect(
      AstMethods.getResolvedSymbolName(unresolvedIdentifier!),
    ).toBeUndefined();
    expect(
      AstMethods.getDeclarationFileName(unresolvedIdentifier!),
    ).toBeUndefined();
    expect(AstMethods.getDeclarationPos(unresolvedIdentifier!)).toBeUndefined();
  });
});
