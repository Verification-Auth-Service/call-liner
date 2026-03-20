# call-liner

`call-liner` は、認証・認可フロー向けの静的解析、sandbox 実行、CI 品質ゲート実行を行うツールです。

## 前提

- Node.js 20 以上
- pnpm 10 系

## セットアップ

```bash
pnpm install
```

## 開発コマンド

```bash
pnpm typecheck
pnpm test
```

## コマンド実行例

```
pnpm --filter call-liner sandbox:run -- \
  --loader-file {適当なパス}/sample-auth-app/apps/auth-app/app/routes/auth+/github-app+/callback.tsx \
  --url "https://app.test/auth/github-app/callback?code=sample-code&state=sample-state" \
  --session "oauth:state=sample-state" \
  --session "oauth:verifier=sample-verifier" \
  --env "GITHUB_APP_CLIENT_ID=dummy-client-id" \
  --env "GITHUB_APP_CLIENT_SECRET=dummy-client-secret" \
  --database-strategy memory-client \
  --database-global prisma \
  --database-model user \
  --database-model oAuthAccount \
  --stub-refresh-token "rotated-refresh-token"
```

```
pnpm --filter call-liner sandbox:run -- \
  --scenario oauth-two-step \
  --authorize-loader-file {適当なパス}/sample-auth-app/apps/auth-app/app/routes/auth+/github-app+/_index.tsx \
  --callback-loader-file {適当なパス}/sample-auth-app/apps/auth-app/app/routes/auth+/github-app+/callback.tsx \
  --authorize-url "https://app.test/auth/github-app" \
  --callback-url-base "https://app.test/auth/github-app/callback" \
  --state-fuzzing \
  --spec-validate \
  --state-expiry-ms 60000000000 \
  --database-strategy memory-client \
  --database-global prisma \
  --database-model user \
  --database-model oAuthAccount \
  --env "GITHUB_APP_CLIENT_ID=dummy-client-id" \
  --env "GITHUB_APP_CLIENT_SECRET=dummy-client-secret" \
  --stub-refresh-token "rotated-refresh-token"
```