# call-liner

## 前提

- Node.js 20 以上
- pnpm 10 系

## セットアップ

```bash
pnpm install
```

## 実行方法

### 1) 通常実行（ワークスペースルートから）

```bash
pnpm dev -- --client-entry /path/to/client.tsx --resource-entry /path/to/resource.ts
```

`-d` を付けると `report/source` にデバッグ用 AST(JSON) が出力されます。

```bash
pnpm dev -- -d --client-entry /path/to/client.tsx --resource-entry /path/to/resource.ts
```

`--ast-json` を付けると処理向けの集約 JSON (`report/ast-data.json`) が出力されます。

```bash
pnpm dev -- --ast-json --client-entry /path/to/client.tsx --resource-entry /path/to/resource.ts
```

実行後、`report/entrypoints.json` が生成されます（`-d` / `--ast-json` は必要に応じて追加）。

### 2) アプリ配下から直接実行

```bash
cd apps/call-liner
pnpm dev -- --client-entry /path/to/client.tsx --resource-entry /path/to/resource.ts
```

## 開発コマンド

```bash
pnpm typecheck
pnpm test
```

## AST(JSON) 変換の利用例

`apps/call-liner/src/ast/program-to-ast-json.ts` の `programToAstJson` を利用します。

```ts
import { programToAstJson } from "./src/ast/program-to-ast-json";

const tree = programToAstJson("const x = 1;");
console.log(JSON.stringify(tree, null, 2));
```
