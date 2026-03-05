import { createHash } from "node:crypto";

/**
 * 文字列を sha256 でハッシュ化し、16進文字列を返す。
 *
 * 入力例: "hello"
 * 出力例: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
 */
export const hashString = (input: string): string => {
  // 空文字を許可すると呼び出し元の入力不備を見逃しやすいため、明示的に弾く。
  if (input.length === 0) {
    throw new TypeError("ハッシュ化する文字列は1文字以上で指定してください。");
  }

  return createHash("sha256").update(input, "utf8").digest("hex");
};
