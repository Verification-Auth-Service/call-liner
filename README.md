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

`report/attack-dsl.json` には、攻撃 DSL 生成結果と静的解析の警告分類が含まれます。

- `generated`: 攻撃 DSL を正常生成できた観点
- `inconclusive`: 解析不能で十分な攻撃 DSL を生成できなかった観点
- `missingOrSuspect`: 必須防御が見当たらず不備の可能性が高い観点

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

## サンドボックス実行

`loader` を統合サンドボックスで直接実行できます。初回 request は必須で、必要に応じて `--advance-ms` と `--replay` を追加できます。

```bash
pnpm --filter call-liner sandbox:run -- \
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

## OAuth 2 ステップ実行（authorize + callback）

`authorize` と `callback` の route loader を 2 ステップで連続実行できます。`--scenario oauth-two-step` で実行モードを切り替え、`--state-mode` で callback 側の `state` を切り替えて正常系・改ざん・欠落を探索できます。

```bash
pnpm --filter call-liner sandbox:run -- \
  --scenario oauth-two-step \
  --authorize-loader-file /home/shio4001/workspace/typeauth-project/sample-auth-app/apps/auth-app/app/routes/auth+/github+/_index.tsx \
  --callback-loader-file /home/shio4001/workspace/typeauth-project/sample-auth-app/apps/auth-app/app/routes/auth+/github+/callback.tsx \
  --authorize-url "https://app.test/auth/github" \
  --callback-url-base "https://app.test/auth/github/callback" \
  --state-mode match_authorize \
  --env "GITHUB_CLIENT_ID=dummy-client-id" \
  --env "GITHUB_CLIENT_SECRET=dummy-client-secret"
```

実行結果は JSON で出力され、`steps` / `callbackRequest` / `cookieJar` / `trace` を確認できます。

`--state-fuzzing` を付けると `missing_state` / `replay_state` / `different_state` / `double_callback` / `callback_before_authorize` / `callback_after_expiry` を自動生成します。`--spec-validate` を併用すると仕様違反を `vulnerability` として `fuzzing.vulnerabilities` に出力します。

`--graph-explore` を付けると action 順序の順列探索を実行します。`--refresh-loader-file` と `--refresh-url` を指定した場合は `authorize/callback/refresh` の全順序を探索し、`graphExploration.paths` へ結果を出力します。

## 設計ドキュメント

- [Timeline Sandbox 実装方針（ドラフト）](docs/timeline-sandbox-implementation-plan.md)

## AST(JSON) 変換の利用例

`apps/call-liner/src/ast/program-to-ast-json.ts` の `programToAstJson` を利用します。

```ts
import { programToAstJson } from "./src/ast/program-to-ast-json";

const tree = programToAstJson("const x = 1;");
console.log(JSON.stringify(tree, null, 2));
```
