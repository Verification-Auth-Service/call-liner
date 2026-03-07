# call-liner GitHub Actions CI ガイド

この文書は `apps/call-liner` を GitHub Actions の CI ジョブとして運用するための詳細ガイドです。  
中心になる実行コマンドは `pnpm --filter call-liner ci -- --config ...` ですが、目的はローカル汎用 runner ではなく GitHub Actions 上の品質ゲートです。

## 1. 目的

`call-liner ci` は、GitHub Actions から安定して呼び出せる品質ゲート実行レイヤです。

このコマンドは次を担当します。

- 設定ファイルを読み込む
- 複数 project / task を順に実行する
- 成果物を標準ディレクトリへ出力する
- `pass` / `fail` / `error` を分類する
- GitHub Actions の job failure と結びつく終了コードを返す

前提として、`call-liner ci` 自体は GitHub Actions 専用 API ではありません。  
ただし設計上は GitHub Actions で使うことを主目的にしており、次の要件に合わせています。

- 非対話で動く
- 成果物ディレクトリが固定できる
- exit code が安定している
- artifact upload しやすい
- monorepo でも `project.root` 単位で対象を切れる

## 2. インストールと前提

### 2.1 前提

- Node.js 20 以上
- pnpm 10 系

### 2.2 セットアップ

リポジトリルートで実行します。

```bash
pnpm install
```

## 3. GitHub Actions での実行方法

### 3.1 ローカルで GitHub Actions 相当の実行を試す

```bash
pnpm --filter call-liner ci -- --config ./call-liner.ci.json
```

### 3.2 artifact 出力先を GitHub Actions 向けに上書きする

```bash
pnpm --filter call-liner ci -- \
  --config ./call-liner.ci.json \
  --output-dir ./tmp/call-liner-artifacts
```

## 4. GitHub Actions で最低限必要なもの

- `call-liner ci` コマンド
- `call-liner.ci.json` のような設定ファイル
- workflow YAML
- `actions/upload-artifact` で成果物を保存する設定

## 5. CLI パラメータ

### 4.1 必須パラメータ

| パラメータ | 説明 |
| --- | --- |
| `--config <path>` | CI 設定ファイルのパス |

### 4.2 任意パラメータ

| パラメータ | 説明 |
| --- | --- |
| `--output-dir <path>` | 成果物ディレクトリを上書きする |

### 4.3 エラー条件

| 条件 | 挙動 |
| --- | --- |
| `--config` 未指定 | 即時エラー |
| 設定ファイルが読めない | `error` |
| `version !== 1` | 即時エラー |
| `projects` が配列でない | 即時エラー |

## 6. 設定ファイル形式

現時点の `call-liner ci` は JSON 設定を受け付けます。

### 5.1 全体構造

```json
{
  "version": 1,
  "outputDir": "artifacts/call-liner",
  "projects": [
    {
      "id": "auth-app",
      "root": "apps/auth-app",
      "tasks": []
    }
  ]
}
```

### 5.2 フィールド説明

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `version` | `1` | 必須 | 設定ファイルのバージョン |
| `outputDir` | `string` | 任意 | 成果物出力先。未指定時は `artifacts/call-liner` |
| `projects` | `array` | 必須 | CI 対象 project 一覧 |

### 5.3 `project` オブジェクト

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `id` | `string` | 必須 | project 識別子 |
| `root` | `string` | 必須 | project root。設定ファイルからの相対パスで解釈 |
| `tasks` | `array` | 必須 | 実行する task 一覧 |

## 7. Task 種類

`call-liner ci` が現在サポートする task は 3 種類です。

| kind | 役割 |
| --- | --- |
| `analyze` | 静的解析を実行する |
| `single` | 単一 loader を sandbox 実行する |
| `oauth-two-step` | OAuth authorize -> callback を sandbox 実行する |

## 8. `analyze` task

### 7.1 例

```json
{
  "id": "parse-auth-app",
  "kind": "analyze",
  "clientEntry": "app/root.tsx",
  "clientFramework": "react-router",
  "outputAstJson": true
}
```

### 7.2 フィールド一覧

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `id` | `string` | 必須 | task 識別子 |
| `kind` | `"analyze"` | 必須 | task 種類 |
| `clientEntry` | `string` | 必須 | client 側エントリ |
| `resourceEntry` | `string` | 任意 | resource 側エントリ |
| `clientFramework` | `"generic" \| "react-router"` | 任意 | client 側解析戦略 |
| `resourceFramework` | `"generic" \| "react-router"` | 任意 | resource 側解析戦略 |
| `debug` | `boolean` | 任意 | `report/source` を出す |
| `outputAstJson` | `boolean` | 任意 | `ast-data.json`, `action-space.json`, `attack-dsl.json` を出す |

### 7.3 挙動

- 非対話で実行されます。
- 既存出力先があっても task 専用ディレクトリを clean して再生成します。
- 静的解析が成功すれば `pass` です。
- path 解決や解析に失敗した場合は `error` です。

## 9. `single` task

### 8.1 例

```json
{
  "id": "protected-resource-no-token",
  "kind": "single",
  "loaderFile": "app/routes/api/resource.tsx",
  "url": "https://app.test/api/resource",
  "method": "GET",
  "expectStatus": 401
}
```

### 8.2 フィールド一覧

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `id` | `string` | 必須 | task 識別子 |
| `kind` | `"single"` | 必須 | task 種類 |
| `loaderFile` | `string` | 必須 | 実行対象 loader |
| `url` | `string` | 必須 | request URL |
| `method` | `string` | 任意 | HTTP method |
| `requestId` | `string` | 任意 | replay 用 request ID |
| `session` | `Record<string, string>` | 任意 | セッション初期値 |
| `env` | `Record<string, string>` | 任意 | 実行中だけ使う環境変数 |
| `database.strategy` | `"none" \| "memory-client"` | 任意 | DB スタブ戦略 |
| `database.global` | `string` | 任意 | DB グローバル名 |
| `database.models` | `string[]` | 任意 | DB model 名 |
| `advanceMs` | `number[]` | 任意 | 仮想時刻進行 |
| `replay` | `(string \| number)[]` | 任意 | 過去 request 再送 |
| `expectStatus` | `number` | 任意 | 最終 request / replay の期待 status |

### 8.3 判定

- `expectStatus` 未指定:
  - 実行成功なら `pass`
- `expectStatus` 指定あり:
  - 最終 HTTP step の status が一致すれば `pass`
  - 一致しなければ `fail`
- loader 読み込み失敗や task 設定不正:
  - `error`

## 10. `oauth-two-step` task

### 9.1 例

```json
{
  "id": "github-oauth",
  "kind": "oauth-two-step",
  "authorizeLoaderFile": "app/routes/auth+/github+/_index.tsx",
  "callbackLoaderFile": "app/routes/auth+/github+/callback.tsx",
  "authorizeUrl": "https://app.test/auth/github",
  "callbackUrlBase": "https://app.test/auth/github/callback",
  "stateFuzzing": true,
  "specValidate": true,
  "failOnVulnerability": true,
  "database": {
    "strategy": "memory-client",
    "global": "prisma",
    "models": ["user", "oAuthAccount"]
  }
}
```

### 9.2 フィールド一覧

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `id` | `string` | 必須 | task 識別子 |
| `kind` | `"oauth-two-step"` | 必須 | task 種類 |
| `authorizeLoaderFile` | `string` | 必須 | authorize loader |
| `callbackLoaderFile` | `string` | 必須 | callback loader |
| `refreshLoaderFile` | `string` | 任意 | refresh loader |
| `authorizeUrl` | `string` | 必須 | authorize request URL |
| `callbackUrlBase` | `string` | 必須 | callback request URL ベース |
| `refreshUrl` | `string` | 任意 | refresh request URL |
| `callbackCode` | `string` | 任意 | callback code |
| `callbackState` | `string` | 任意 | callback state 固定値 |
| `stateMode` | `"match_authorize" \| "tampered" \| "missing" \| "fixed"` | 任意 | callback state 生成戦略 |
| `stateFuzzing` | `boolean` | 任意 | state fuzzing 有効化 |
| `graphExplore` | `boolean` | 任意 | graph exploration 有効化 |
| `specValidate` | `boolean` | 任意 | 副作用ベース判定有効化 |
| `stateExpiryMs` | `number` | 任意 | expiry 攻撃で使う経過時間 |
| `session` | `Record<string, string>` | 任意 | セッション初期値 |
| `env` | `Record<string, string>` | 任意 | 実行中だけ使う環境変数 |
| `database.strategy` | `"none" \| "memory-client"` | 任意 | DB スタブ戦略 |
| `database.global` | `string` | 任意 | DB グローバル名 |
| `database.models` | `string[]` | 任意 | DB model 名 |
| `failOnVulnerability` | `boolean` | 任意 | vulnerability を fail 扱いにするか |

### 9.3 判定

- `failOnVulnerability: true` または未指定:
  - `fuzzing.vulnerabilities` と `graphExploration.vulnerabilities` の合計が 1 件以上なら `fail`
- `failOnVulnerability: false`:
  - vulnerability があっても task 自体は `pass`
- loader 読み込み失敗や task 設定不正:
  - `error`

## 11. path 解決ルール

### 10.1 `project.root`

- 設定ファイルからの相対パスとして解釈されます。

例:

```json
{
  "root": "apps/auth-app"
}
```

### 10.2 task 内のファイルパス

- `clientEntry`
- `resourceEntry`
- `loaderFile`
- `authorizeLoaderFile`
- `callbackLoaderFile`
- `refreshLoaderFile`

これらは次のルールで解釈されます。

- 絶対パス:
  - そのまま使用
- 相対パス:
  - `project.root` 基準で解決

## 12. 出力物

既定では設定ファイルのあるディレクトリ配下に `artifacts/call-liner` が作られます。

### 11.1 全体成果物

| パス | 内容 |
| --- | --- |
| `artifacts/call-liner/summary.json` | 全 task の集約結果 |
| `artifacts/call-liner/summary.md` | 人が読みやすい要約 |

### 11.2 project ごとの成果物

| パス | 内容 |
| --- | --- |
| `artifacts/call-liner/<project-id>/` | project 単位ディレクトリ |
| `artifacts/call-liner/<project-id>/<task-id>/` | `analyze` task の出力先 |
| `artifacts/call-liner/<project-id>/<task-id>.json` | `single` / `oauth-two-step` task の JSON 成果物 |

## 13. `summary.json` 形式

例:

```json
{
  "version": 1,
  "status": "fail",
  "counts": {
    "pass": 2,
    "fail": 1,
    "error": 0
  },
  "results": [
    {
      "projectId": "auth-app",
      "taskId": "parse",
      "kind": "analyze",
      "status": "pass",
      "summary": "analysis completed"
    }
  ]
}
```

### 12.1 `status` の意味

| 値 | 意味 |
| --- | --- |
| `pass` | 全 task が成功 |
| `fail` | 少なくとも 1 件の品質ゲート違反あり |
| `error` | 少なくとも 1 件の内部エラーまたは設定エラーあり |

### 12.2 task 結果の主なフィールド

| フィールド | 説明 |
| --- | --- |
| `projectId` | project ID |
| `taskId` | task ID |
| `kind` | task 種類 |
| `status` | `pass` / `fail` / `error` |
| `summary` | 短い説明 |
| `artifactPath` | 成果物相対パス |
| `details` | task ごとの補足 |
| `error.message` | `error` 時の詳細 |

## 14. 終了コード

`call-liner ci` は CI 向けに終了コードを固定しています。

| 終了コード | 条件 |
| --- | --- |
| `0` | `fail=0` かつ `error=0` |
| `1` | `fail>0` かつ `error=0` |
| `2` | `error>0` かつ `fail=0` |
| `3` | `fail>0` かつ `error>0` |

## 15. 設定例

### 14.1 1 project / 2 task の最小例

```json
{
  "version": 1,
  "projects": [
    {
      "id": "auth-app",
      "root": "apps/auth-app",
      "tasks": [
        {
          "id": "parse",
          "kind": "analyze",
          "clientEntry": "app/root.tsx",
          "clientFramework": "react-router",
          "outputAstJson": true
        },
        {
          "id": "resource-no-token",
          "kind": "single",
          "loaderFile": "app/routes/api/resource.tsx",
          "url": "https://app.test/api/resource",
          "expectStatus": 401
        }
      ]
    }
  ]
}
```

### 14.2 OAuth 品質ゲート例

```json
{
  "version": 1,
  "outputDir": "artifacts/call-liner",
  "projects": [
    {
      "id": "auth-app",
      "root": "apps/auth-app",
      "tasks": [
        {
          "id": "github-oauth-parse",
          "kind": "analyze",
          "clientEntry": "app",
          "clientFramework": "react-router",
          "outputAstJson": true
        },
        {
          "id": "github-oauth-critical",
          "kind": "oauth-two-step",
          "authorizeLoaderFile": "app/routes/auth+/github+/_index.tsx",
          "callbackLoaderFile": "app/routes/auth+/github+/callback.tsx",
          "authorizeUrl": "https://app.test/auth/github",
          "callbackUrlBase": "https://app.test/auth/github/callback",
          "stateFuzzing": true,
          "specValidate": true,
          "failOnVulnerability": true,
          "env": {
            "GITHUB_CLIENT_ID": "dummy-client-id",
            "GITHUB_CLIENT_SECRET": "dummy-client-secret"
          },
          "database": {
            "strategy": "memory-client",
            "global": "prisma",
            "models": ["user", "oAuthAccount"]
          }
        }
      ]
    }
  ]
}
```

## 16. GitHub Actions workflow 例

### 16.1 最小構成

```yaml
name: call-liner-ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  call-liner:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter call-liner typecheck
      - run: pnpm --filter call-liner test
      - run: pnpm --filter call-liner ci -- --config ./call-liner.ci.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: call-liner
          path: artifacts/call-liner
```

### 16.2 PR と main で job を分ける例

```yaml
name: call-liner-ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  parse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter call-liner ci -- --config ./call-liner.ci.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: call-liner
          path: artifacts/call-liner
```

### 16.3 GitHub Actions での扱い方

- `exit code 0`: job success
- `exit code 1`: 品質ゲート fail
- `exit code 2`: 実行エラー
- `exit code 3`: fail と error が混在

つまり GitHub Actions では、追加の wrapper script なしで job failure にできます。

### 16.4 artifact upload の対象

最低限アップロードするのは次です。

- `artifacts/call-liner/summary.json`
- `artifacts/call-liner/summary.md`
- `artifacts/call-liner/<project-id>/...`

### 16.5 GitHub Actions 向けの実運用上の注意

- `graphExplore` は PR 必須ジョブに入れすぎない
- `stateFuzzing` は critical path に絞る
- `fail` と `error` を混同しない
- 成果物は `if: always()` で upload する

## 17. 運用上の推奨

### 16.1 PR 必須に向く task

- `analyze`
- `single`
- `oauth-two-step` の固定 critical scenario

### 16.2 main / nightly 向き task

- `oauth-two-step` + `graphExplore`
- 重い `stateFuzzing` セット

### 16.3 fail と error の使い分け

- `fail`:
  - 品質ゲート違反
  - 想定 status 不一致
  - vulnerability 検出
- `error`:
  - 設定ミス
  - loader 読み込み失敗
  - 実行不能

## 18. 既存の `test` workflow との違い

`pnpm test` を流す workflow は「ツール自身の回帰テスト」です。  
`pnpm --filter call-liner ci -- --config ...` を流す workflow は「call-liner を使って対象アプリを検査する CI」です。

この 2 つは役割が違います。

- ツールの開発を守る:
  - `typecheck`
  - `test`
- 対象アプリを守る:
  - `call-liner ci`

GitHub Actions では両方を並べるのが自然です。

## 19. よくある質問

### 17.1 YAML は使えますか

現時点では使えません。`call-liner ci` は JSON 設定を読み込みます。

### 17.2 1 つの repo で複数 app を扱えますか

扱えます。`projects` を複数定義してください。

### 17.3 task の並列実行はしますか

現時点では逐次実行です。

### 17.4 baseline 比較や JUnit 出力はありますか

現時点ではありません。`summary.json` / `summary.md` が基本成果物です。

## 20. 関連文書

- [CLI リファレンス](./cli-reference.md)
- [ツール機能詳細](./tool-features.md)
