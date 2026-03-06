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

`--ast-json` を付けると処理向けの集約 JSON (`report/ast-data.json`)、静的解析ベースのアクション空間 (`report/action-space.json`)、攻撃シナリオ DSL (`report/attack-dsl.json`) が出力されます。

```bash
pnpm dev -- --ast-json --client-entry /path/to/client.tsx --resource-entry /path/to/resource.ts
```

実行後、`report/entrypoints.json` が生成されます（`-d` / `--ast-json` は必要に応じて追加）。

`--client-framework` / `--resource-framework` でフレームワーク戦略を切り替えできます（`generic` / `react-router`）。

```bash
pnpm dev -- --ast-json --client-entry apps/auth-app/app --client-framework react-router
```

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

## Phase 1 サンドボックス実行

`loader` を関数レベルで直接実行できます。例として、`sample-auth-app` の callback route をパス指定で実行できます。

```bash
pnpm --filter call-liner sandbox:phase1 -- \
  --loader-file /home/shio4001/workspace/typeauth-project/sample-auth-app/apps/auth-app/app/routes/auth+/github+/callback.tsx \
  --url "https://app.test/auth/github/callback?code=test-code&state=test-state" \
  --session "oauth:state=test-state" \
  --session "oauth:verifier=test-verifier" \
  --env "GITHUB_CLIENT_ID=dummy-client-id" \
  --env "GITHUB_CLIENT_SECRET=dummy-client-secret"
```

実行結果は JSON で出力され、`status` / `location` / `cookieJar` / `trace` を確認できます。

## Phase 2 サンドボックス実行

Phase 1 と同じ引数で初回 request を実行し、追加で `--advance-ms` と `--replay` が使えます。

```bash
pnpm --filter call-liner sandbox:phase2 -- \
  --loader-file /home/shio4001/workspace/typeauth-project/sample-auth-app/apps/auth-app/app/routes/auth+/github+/callback.tsx \
  --url "https://app.test/auth/github/callback?code=test-code&state=tampered" \
  --request-id "callback" \
  --session "oauth:state=test-state" \
  --session "oauth:verifier=test-verifier" \
  --env "GITHUB_CLIENT_ID=dummy-client-id" \
  --env "GITHUB_CLIENT_SECRET=dummy-client-secret" \
  --advance-ms 610000 \
  --replay callback
```

実行結果は JSON で出力され、`steps` / `cookieJar` / `trace` を確認できます。

## Phase 4 サンドボックス実行（authorize + callback）

`authorize` と `callback` の route loader を 2 ステップで連続実行できます。`--state-mode` で callback 側の `state` を切り替え、正常系・改ざん・欠落を探索できます。

```bash
pnpm --filter call-liner sandbox:phase4 -- \
  --authorize-loader-file /home/shio4001/workspace/typeauth-project/sample-auth-app/apps/auth-app/app/routes/auth+/github+/_index.tsx \
  --callback-loader-file /home/shio4001/workspace/typeauth-project/sample-auth-app/apps/auth-app/app/routes/auth+/github+/callback.tsx \
  --authorize-url "https://app.test/auth/github" \
  --callback-url-base "https://app.test/auth/github/callback" \
  --state-mode match_authorize \
  --env "GITHUB_CLIENT_ID=dummy-client-id" \
  --env "GITHUB_CLIENT_SECRET=dummy-client-secret"
```

実行結果は JSON で出力され、`steps` / `callbackRequest` / `cookieJar` / `trace` を確認できます。

## 設計ドキュメント

- [Timeline Sandbox 実装方針（ドラフト）](docs/timeline-sandbox-implementation-plan.md)

## AST(JSON) 変換の利用例

`apps/call-liner/src/ast/program-to-ast-json.ts` の `programToAstJson` を利用します。

```ts
import { programToAstJson } from "./src/ast/program-to-ast-json";

const tree = programToAstJson("const x = 1;");
console.log(JSON.stringify(tree, null, 2));
```
