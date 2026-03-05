import type { AstJsonNode } from "./program-to-ast-json";

class AstMethods {
  // root
  constructor() {}

  // 子要素の数
  static getChildCount(node: AstJsonNode): number {
    return node.children.length;
  }

  // 子要素の取得
  static getChild(node: AstJsonNode, index: number): AstJsonNode | null {
    if (index < 0 || index >= node.children.length) {
      return null;
    }
    return node.children[index];
  }

  // ノードの種類
  static getKind(node: AstJsonNode): string {
    return node.kind;
  }

  // ノードのテキスト（リテラル値がない場合は undefined）
  static getText(node: AstJsonNode): string | undefined {
    return node.text;
  }

  // ノードの型情報（取得できない場合は undefined）
  static getType(node: AstJsonNode): string | undefined {
    return node.type;
  }

  // 識別子ノードのシンボル名（取得できない場合は undefined）
  static getSymbolName(node: AstJsonNode): string | undefined {
    return node.symbolName;
  }

  // import alias 解決後のシンボル名（取得できない場合は undefined）
  static getResolvedSymbolName(node: AstJsonNode): string | undefined {
    return node.resolvedSymbolName;
  }

  // 解決された宣言のファイル名（取得できない場合は undefined）
  static getDeclarationFileName(node: AstJsonNode): string | undefined {
    return node.declarationFileName;
  }

  // 解決された宣言ノードの位置（取得できない場合は undefined）
  static getDeclarationPos(node: AstJsonNode): number | undefined {
    return node.declarationPos;
  }

  // ノードのリテラル値（数値、文字列、真偽値、null のいずれか。リテラルでない場合は undefined）
  static getLiteralValue(
    node: AstJsonNode,
  ): string | number | boolean | null | undefined {
    return node.literalValue;
  }

  // ノードの一意な識別子
  static getUniqueId(node: AstJsonNode): string {
    return node.uniqueId;
  }

  // ノードが属するファイル名
  static getFileName(node: AstJsonNode): string {
    return node.fileName;
  }
}

export default AstMethods;
