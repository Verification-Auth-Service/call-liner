# sample-auth-app への導入手順

この文書は `/home/shio4001/workspace/typeauth-project/sample-auth-app` に `call-liner` を GitHub Actions の CI として導入する手順です。  
目的は `sample-auth-app` 側の pull request / push で、OAuth route と protected resource を `call-liner` で検査できるようにすることです。

## 1. 前提

この手順は次を前提にしています。

- `sample-auth-app` と `call-liner` は別 repository か、少なくとも別 checkout として扱う
- `sample-auth-app` の Git repository root は `/home/shio4001/workspace/typeauth-project/sample-auth-app` である
- GitHub Actions から両方を checkout できる
- `sample-auth-app` 側に `call-liner.ci.json` を追加できる
- `sample-auth-app` 側に `.github/workflows/call-liner.yml` を追加できる

### 1.1 repository 境界の扱い

- `apps/auth-app/app` は `auth-app` のソースディレクトリであり、repository root ではない
- `apps/auth-app` は package / project の単位だが、GitHub Actions workflow の配置先は `sample-auth-app/.github/workflows` である
- 今回この文書で扱うのは `auth-app` 単体の build/test CI ではなく、`sample-auth-app` repository 上で `call-liner` を実行する workflow である
- そのため、変更先は `call-liner` repo ではなく `sample-auth-app` repo の `.github/workflows/call-liner.yml` になる

## 2. まず何を検査するか

`sample-auth-app` で最初に CI 対象へ入れるのは次です。

- `apps/auth-app`
  - GitHub OAuth
  - GitHub App OAuth
  - Resource Server OAuth
- `apps/resource-server`
  - protected resource の未認証拒否

今回の手順では、実ファイルとして次を使います。

### 2.1 auth-app 側

- `apps/auth-app/app/routes/auth+/github+/_index.tsx`
- `apps/auth-app/app/routes/auth+/github+/callback.tsx`
- `apps/auth-app/app/routes/auth+/github-app+/_index.tsx`
- `apps/auth-app/app/routes/auth+/github-app+/callback.tsx`
- `apps/auth-app/app/routes/auth+/resource+/_index.tsx`
- `apps/auth-app/app/routes/auth+/resource+/callback.tsx`

### 2.2 resource-server 側

- `apps/resource-server/app/routes/api.protected.ts`

## 3. sample-auth-app に追加するファイル

`sample-auth-app` 側には最低 2 つのファイルを追加します。

1. `call-liner.ci.json`
2. `.github/workflows/call-liner.yml`

テンプレートは `call-liner` repo 側に用意してあります。

- 設定例: [docs/examples/sample-auth-app.call-liner.ci.json](/home/shio4001/workspace/typeauth-project/call-liner/docs/examples/sample-auth-app.call-liner.ci.json)
- workflow 例: [docs/examples/sample-auth-app.call-liner-ci.yml](/home/shio4001/workspace/typeauth-project/call-liner/docs/examples/sample-auth-app.call-liner-ci.yml)

## 4. Step 1: `sample-auth-app` に設定ファイルを置く

`sample-auth-app` のリポジトリルートに `call-liner.ci.json` を追加します。

配置先:

```text
sample-auth-app/
  call-liner.ci.json
```

内容は次のテンプレートを起点にしてください。

- [docs/examples/sample-auth-app.call-liner.ci.json](/home/shio4001/workspace/typeauth-project/call-liner/docs/examples/sample-auth-app.call-liner.ci.json)

### 4.1 この設定で入る task

- `auth-app/parse-auth-app`
  - React Router として `apps/auth-app/app` を静的解析
- `auth-app/github-oauth`
  - GitHub OAuth authorize -> callback を state fuzzing + spec validation
- `auth-app/github-app-oauth`
  - GitHub App OAuth authorize -> callback を state fuzzing + spec validation
  - `prisma.oAuthAccount.upsert(...)` を通すため `database.global = "prisma"` を含む
- `auth-app/resource-oauth`
  - Resource Server OAuth authorize -> callback を state fuzzing + spec validation
- `resource-server/parse-resource-server`
  - `apps/resource-server/app` を静的解析
- `resource-server/protected-resource-no-token`
  - `api.protected.ts` が未認証時に `401` を返すことを検査

### 4.2 なぜこのセットなのか

- `analyze`
  - route 構造の崩れを早く検知するため
- `oauth-two-step`
  - 認証フローの reject 条件を副作用ベースで検査するため
- `single`
  - protected resource の最低限のアクセス制御を固定ケースで見るため

## 5. Step 2: GitHub Actions workflow を追加する

`sample-auth-app` 側に次を追加します。

配置先:

```text
sample-auth-app/
  .github/
    workflows/
      call-liner.yml
```

ベースにするテンプレート:

- [docs/examples/sample-auth-app.call-liner-ci.yml](/home/shio4001/workspace/typeauth-project/call-liner/docs/examples/sample-auth-app.call-liner-ci.yml)

この workflow は `sample-auth-app` 上で `call-liner` を呼び出すためのものです。  
`apps/auth-app/app` 配下に workflow を置くわけではなく、`sample-auth-app` repository ルート配下の `.github/workflows/call-liner.yml` として管理します。

## 6. Step 3: workflow の checkout 設定を自分の環境に合わせる

テンプレートには次の行があります。

```yaml
repository: YOUR_ORG_OR_USER/call-liner
```

ここを、実際の `call-liner` repository に置き換えてください。

例:

```yaml
repository: shio4001/call-liner
```

### 6.1 private repository の場合

`call-liner` が private repository の場合は、2 つ目の `actions/checkout` に token を追加してください。

例:

```yaml
with:
  repository: shio4001/call-liner
  path: call-liner
  token: ${{ secrets.CI_REPO_READ_TOKEN }}
```

## 7. Step 4: workflow が実際に何をしているか

workflow は次の順で動きます。

1. `sample-auth-app` を checkout
2. `call-liner` を別 path で checkout
3. 両方の dependency を install
4. `call-liner` 側の workspace で `pnpm --filter call-liner ci -- --config ../sample-auth-app/call-liner.ci.json` を実行
5. `sample-auth-app/artifacts/call-liner` を artifact upload

この構成にしている理由は、`call-liner` 本体は `call-liner` repo 側にあり、検査対象設定だけを `sample-auth-app` 側に置きたいためです。

## 8. Step 5: 初回導入時に確認すること

初回 PR では、まず次の観点だけ確認してください。

- workflow が起動するか
- `call-liner.ci.json` が読めるか
- `artifacts/call-liner/summary.json` が出るか
- `auth-app` と `resource-server` の path が正しく解決されるか

この段階では `graphExplore` はまだ入れない方が安全です。

## 9. Step 6: 失敗時の見方

GitHub Actions 上では `call-liner ci` の終了コードで job の成否が決まります。

- `0`
  - 全 task 成功
- `1`
  - 品質ゲート違反
- `2`
  - 設定ミスや実行エラー
- `3`
  - fail と error が混在

### 9.1 まず見るファイル

- `artifacts/call-liner/summary.json`
- `artifacts/call-liner/summary.md`

### 9.2 よくある失敗

- `authorizeLoaderFile` / `callbackLoaderFile` の path が違う
- `sample-auth-app` 側の route 名変更に設定が追従していない
- 必須環境変数が task の `env` に足りない
- `github-app-oauth` で `database` 設定が無く、callback 内の `prisma` 参照が `ReferenceError` になる
- `call-liner` repo の checkout に失敗している

## 10. sample-auth-app 向けの推奨運用

### 10.1 pull request で必須にするもの

- `parse-auth-app`
- `parse-resource-server`
- `github-oauth`
- `github-app-oauth`
- `resource-oauth`
- `protected-resource-no-token`

### 10.2 後から追加するもの

次は別 job か nightly に分けた方がよいです。

- `graphExplore`
- より多い `single` シナリオ
- refresh path を含む探索

## 11. sample-auth-app 側で実際にやる作業のチェックリスト

1. `sample-auth-app/call-liner.ci.json` を追加する
2. `.github/workflows/call-liner.yml` を追加する
3. `YOUR_ORG_OR_USER/call-liner` を実 repository 名へ置き換える
4. private repo なら checkout token を設定する
5. PR を作って workflow が通るか確認する
6. artifact の `summary.json` と `summary.md` を確認する

## 12. そのまま使うための最短コマンド

`sample-auth-app` 側に `call-liner.ci.json` を置いたあと、ローカルで GitHub Actions 相当を試すなら次です。

```bash
cd /home/shio4001/workspace/typeauth-project/call-liner
pnpm --filter call-liner ci -- --config /home/shio4001/workspace/typeauth-project/sample-auth-app/call-liner.ci.json
```

## 13. 補足

今回の手順は `sample-auth-app` を直接編集するための説明です。  
この `call-liner` repo 側では、導入テンプレートだけを追加しています。

## 14. 関連文書

- [GitHub Actions CI ガイド](./ci-guide.md)
- [CLI リファレンス](./cli-reference.md)
- [sample-auth-app 用設定例](/home/shio4001/workspace/typeauth-project/call-liner/docs/examples/sample-auth-app.call-liner.ci.json)
- [sample-auth-app 用 workflow 例](/home/shio4001/workspace/typeauth-project/call-liner/docs/examples/sample-auth-app.call-liner-ci.yml)
