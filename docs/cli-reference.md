# call-liner CLI リファレンス

この文書は `apps/call-liner` の実行方法、インストール方法、各コマンドの用途、パラメータ、出力物を詳細にまとめた利用者向けリファレンスです。

## 1. 対象

- パッケージ: `apps/call-liner`
- 役割:
  - TypeScript / TSX の静的解析
  - 認証・認可フロー向け sandbox 実行
  - CI 品質ゲート実行

## 2. 前提条件

- OS:
  - Linux
  - macOS
  - Windows（WSL 推奨）
- Node.js:
  - 20 以上
- pnpm:
  - 10 系

確認コマンド:

```bash
node --version
pnpm --version
```

## 3. インストール

### 3.1 ワークスペース全体をセットアップする

リポジトリルートで実行します。

```bash
pnpm install
```

### 3.2 `call-liner` のみを使う場合

依存解決は workspace 全体で行うため、基本的にはリポジトリルートで `pnpm install` を実行してください。

その後、`call-liner` のコマンドは次のいずれかで実行します。

```bash
pnpm --filter call-liner dev -- --client-entry /path/to/client.tsx
```

```bash
cd apps/call-liner
pnpm dev -- --client-entry /path/to/client.tsx
```

## 4. コマンド一覧

`call-liner` には大きく 3 種類の実行形態があります。

| コマンド | 用途 | 主な出力 |
| --- | --- | --- |
| `pnpm --filter call-liner dev -- ...` | 静的解析を実行する | `report/entrypoints.json` など |
| `pnpm --filter call-liner sandbox:run -- ...` | loader を sandbox で直接実行する | 標準出力 JSON |
| `pnpm --filter call-liner ci -- --config ...` | 設定ファイル駆動で品質ゲートを実行する | `artifacts/call-liner/summary.json` など |

## 5. 静的解析 CLI

### 5.1 基本形

```bash
pnpm --filter call-liner dev -- \
  --client-entry apps/auth-app/app/root.tsx
```

### 5.2 用途

- エントリポイント解決の確認
- ルート列挙の確認
- AST レポート生成
- action-space / attack-dsl の生成

### 5.3 必須パラメータ

| パラメータ | 説明 | 例 |
| --- | --- | --- |
| `--client-entry <path>` | 解析起点となる client 側エントリ | `apps/auth-app/app/root.tsx` |

### 5.4 任意パラメータ

| パラメータ | 説明 | 既定値 |
| --- | --- | --- |
| `-d` | デバッグ用の AST(JSON) を `report/source` に出力する | 無効 |
| `--ast-json` | 集約 JSON と action-space / attack-dsl を出力する | 無効 |
| `--resource-entry <path>` | resource 側エントリを追加する | なし |
| `--client-framework <generic\|react-router>` | client 側解析戦略を指定する | `generic` |
| `--resource-framework <generic\|react-router>` | resource 側解析戦略を指定する | `generic` |

### 5.5 実行例

#### client のみ解析

```bash
pnpm --filter call-liner dev -- \
  --client-entry apps/auth-app/app/root.tsx
```

#### client と resource を解析

```bash
pnpm --filter call-liner dev -- \
  --client-entry apps/auth-app/app/root.tsx \
  --resource-entry apps/resource-server/app
```

#### React Router として解析し、集約 JSON も出力

```bash
pnpm --filter call-liner dev -- \
  --ast-json \
  --client-entry apps/auth-app/app \
  --client-framework react-router
```

#### デバッグ AST も出力

```bash
pnpm --filter call-liner dev -- \
  -d \
  --ast-json \
  --client-entry apps/auth-app/app \
  --client-framework react-router
```

### 5.6 出力物

既定の出力先は実行起点ディレクトリ配下の `report/` です。

| ファイル | 条件 | 内容 |
| --- | --- | --- |
| `report/entrypoints.json` | 常に出力 | 解決された entry, routes, writtenFiles |
| `report/source/**/*.json` | `-d` 時のみ | ソースごとの AST(JSON) |
| `report/ast-data.json` | `--ast-json` 時のみ | 集約 AST データ |
| `report/action-space.json` | `--ast-json` 時のみ | action/resource/guard の抽出結果 |
| `report/attack-dsl.json` | `--ast-json` 時のみ | 攻撃シナリオ DSL と警告 |

### 5.7 エラー条件

| 条件 | 挙動 |
| --- | --- |
| `--client-entry` 未指定 | 使い方エラー |
| framework 値が不正 | 即時エラー |
| 既存 `report/` があり、対話で拒否した | 中止 |
| entry path が存在しない | 実行失敗 |

## 6. Sandbox CLI

### 6.1 基本形

```bash
pnpm --filter call-liner sandbox:run -- \
  --loader-file /absolute/path/to/callback.tsx \
  --url "https://app.test/auth/github/callback?code=test&state=s1"
```

### 6.2 用途

- loader を HTTP サーバなしで直接実行する
- request / cookie / env / session を制御して再現試験する
- OAuth authorize -> callback を 2 ステップで実行する
- state fuzzing / graph exploration / spec validation を行う

### 6.3 シナリオ

| シナリオ | 指定方法 | 用途 |
| --- | --- | --- |
| `single` | 既定値 | 1 つの loader に対する request / replay / time advance |
| `oauth-two-step` | `--scenario oauth-two-step` | authorize -> callback の連続実行 |

## 7. `single` シナリオ

### 7.1 必須パラメータ

| パラメータ | 説明 |
| --- | --- |
| `--loader-file <path>` | 実行対象 loader ファイル |
| `--url <request-url>` | request に渡す URL |

### 7.2 任意パラメータ

| パラメータ | 説明 | 既定値 |
| --- | --- | --- |
| `--method <HTTP method>` | request method | `GET` |
| `--request-id <id>` | replay で参照する request 識別子 | `initial` |
| `--advance-ms <int>` | 仮想時刻を進める。複数指定可 | なし |
| `--replay <request-id\|operation-index>` | 過去リクエストの再送。複数指定可 | なし |
| `--session key=value` | セッション初期値 | なし |
| `--env key=value` | 実行中のみ適用する環境変数 | なし |
| `--database-strategy <none\|memory-client>` | DB スタブ戦略 | `none` |
| `--database-global <name>` | DB グローバル変数名 | `db` |
| `--database-model <name>` | 注入する model delegate 名。複数指定可 | なし |
| `--stub-refresh-token <token>` | OAuth token スタブの refresh_token 差し替え | なし |
| `--stub-github-repos-status <status>` | GitHub repos API status 差し替え | なし |

### 7.3 実行例

#### 単発 request

```bash
pnpm --filter call-liner sandbox:run -- \
  --loader-file /work/app/routes/auth+/github+/callback.tsx \
  --url "https://app.test/auth/github/callback?code=test-code&state=test-state"
```

#### 時間経過と replay

```bash
pnpm --filter call-liner sandbox:run -- \
  --loader-file /work/app/routes/auth+/github+/callback.tsx \
  --url "https://app.test/auth/github/callback?code=test-code&state=test-state" \
  --request-id callback \
  --advance-ms 610000 \
  --replay callback
```

#### セッションと環境変数を注入

```bash
pnpm --filter call-liner sandbox:run -- \
  --loader-file /work/app/routes/auth+/github+/callback.tsx \
  --url "https://app.test/auth/github/callback?code=test-code&state=test-state" \
  --session "oauth:state=test-state" \
  --session "oauth:verifier=test-verifier" \
  --env "GITHUB_CLIENT_ID=dummy-client-id" \
  --env "GITHUB_CLIENT_SECRET=dummy-client-secret"
```

### 7.4 出力 JSON

主な出力フィールド:

| フィールド | 説明 |
| --- | --- |
| `steps` | 実行された操作列 |
| `cookieJar` | 実行後の cookie 状態 |
| `trace` | request / response / fetch / cookie_set などの trace |

`steps` には `request`, `advance_time`, `replay` が含まれます。

## 8. `oauth-two-step` シナリオ

### 8.1 必須パラメータ

| パラメータ | 説明 |
| --- | --- |
| `--scenario oauth-two-step` | 2 ステップモードを有効化する |
| `--authorize-loader-file <path>` | authorize loader |
| `--callback-loader-file <path>` | callback loader |
| `--authorize-url <request-url>` | authorize request URL |
| `--callback-url-base <request-url>` | callback request の URL ベース |

### 8.2 任意パラメータ

| パラメータ | 説明 | 既定値 |
| --- | --- | --- |
| `--refresh-loader-file <path>` | refresh loader | なし |
| `--refresh-url <request-url>` | refresh request URL | なし |
| `--callback-code <code>` | callback request の `code` | `sandbox-code` |
| `--state-mode <match_authorize\|tampered\|missing\|fixed>` | callback の state 生成戦略 | `match_authorize` |
| `--callback-state <state>` | 固定 state 値 | なし |
| `--state-fuzzing` | 攻撃ケースを自動生成する | 無効 |
| `--graph-explore` | action 順序と拡張パスを探索する | 無効 |
| `--spec-validate` | 副作用ベースの vulnerability 判定を有効化する | 無効 |
| `--state-expiry-ms <int>` | expiry 攻撃時の経過時間 | `610000` |
| `--session key=value` | セッション初期値 | なし |
| `--env key=value` | 実行中のみ適用する環境変数 | なし |
| `--database-strategy <none\|memory-client>` | DB スタブ戦略 | `none` |
| `--database-global <name>` | DB グローバル変数名 | `db` |
| `--database-model <name>` | 注入する model delegate 名。複数指定可 | なし |
| `--stub-refresh-token <token>` | OAuth token スタブの refresh_token 差し替え | なし |
| `--stub-github-repos-status <status>` | GitHub repos API status 差し替え | なし |

### 8.3 実行例

#### 正常系 authorize -> callback

```bash
pnpm --filter call-liner sandbox:run -- \
  --scenario oauth-two-step \
  --authorize-loader-file /work/app/routes/auth+/github+/_index.tsx \
  --callback-loader-file /work/app/routes/auth+/github+/callback.tsx \
  --authorize-url "https://app.test/auth/github" \
  --callback-url-base "https://app.test/auth/github/callback" \
  --state-mode match_authorize \
  --env "GITHUB_CLIENT_ID=dummy-client-id" \
  --env "GITHUB_CLIENT_SECRET=dummy-client-secret"
```

#### state fuzzing + spec validation

```bash
pnpm --filter call-liner sandbox:run -- \
  --scenario oauth-two-step \
  --authorize-loader-file /work/app/routes/auth+/github+/_index.tsx \
  --callback-loader-file /work/app/routes/auth+/github+/callback.tsx \
  --authorize-url "https://app.test/auth/github" \
  --callback-url-base "https://app.test/auth/github/callback" \
  --state-fuzzing \
  --spec-validate \
  --database-strategy memory-client \
  --database-global prisma \
  --database-model user \
  --database-model oAuthAccount
```

#### refresh を含めた探索

```bash
pnpm --filter call-liner sandbox:run -- \
  --scenario oauth-two-step \
  --authorize-loader-file /work/app/routes/auth+/github+/_index.tsx \
  --callback-loader-file /work/app/routes/auth+/github+/callback.tsx \
  --refresh-loader-file /work/app/routes/auth+/github+/refresh.tsx \
  --authorize-url "https://app.test/auth/github" \
  --callback-url-base "https://app.test/auth/github/callback" \
  --refresh-url "https://app.test/auth/github/refresh" \
  --graph-explore \
  --spec-validate
```

### 8.4 出力 JSON

主な出力フィールド:

| フィールド | 説明 |
| --- | --- |
| `steps` | authorize / callback / refresh のステップ列 |
| `callbackRequest` | callback 実行時の request 情報 |
| `fuzzing.attacks` | `--state-fuzzing` の各攻撃ケース |
| `fuzzing.vulnerabilities` | `--spec-validate` による違反一覧 |
| `graphExploration.paths` | `--graph-explore` の各探索パス |
| `graphExploration.vulnerabilities` | graph exploration 中に見つかった違反 |
| `cookieJar` | 実行後 cookie 状態 |
| `trace` | sandbox trace |

### 8.5 `--state-fuzzing` で生成される attack id

| attack id | 内容 |
| --- | --- |
| `missing_state` | callback から state を欠落させる |
| `replay_state` | 同じ callback を replay する |
| `different_state` | authorize と異なる state を送る |
| `double_callback` | callback を 2 回送る |
| `callback_before_authorize` | authorize 前に callback を送る |
| `callback_after_expiry` | state 期限切れ後に callback を送る |

### 8.6 `--spec-validate` の判定観点

`--spec-validate` は HTTP status のみではなく、次の副作用を見ます。

- token endpoint fetch
- `Set-Cookie`
- DB write

reject すべきケースでこれらが発生した場合、`vulnerability` として出力します。

## 9. CI CLI

CI 用の詳細は [CI ガイド](./ci-guide.md) を参照してください。ここでは概要だけ載せます。

### 9.1 基本形

```bash
pnpm --filter call-liner ci -- --config ./call-liner.ci.json
```

### 9.2 できること

- 複数 project / 複数 task をまとめて実行する
- `analyze`, `single`, `oauth-two-step` を設定ファイルで束ねる
- `summary.json`, `summary.md` を出力する
- exit code により CI 判定を安定化する

## 10. 開発者向けコマンド

```bash
pnpm --filter call-liner typecheck
pnpm --filter call-liner test
```

workspace 全体をまとめて検証する場合:

```bash
pnpm typecheck
pnpm test
```

## 11. よくある失敗

### 11.1 `Unknown argument` が出る

- CLI の種類が違う可能性があります。
- `dev` に sandbox 専用引数を渡していないか確認してください。
- `ci` では `--config` 以外の直接 task 引数は受け付けません。

### 11.2 `Missing required argument` が出る

- 必須パラメータ不足です。
- `single` なら `--loader-file` と `--url` を確認してください。
- `oauth-two-step` なら `--authorize-loader-file`, `--callback-loader-file`, `--authorize-url`, `--callback-url-base` を確認してください。

### 11.3 `report` が既にあり中断される

- 通常 CLI は既定で対話削除確認を行います。
- CI では `call-liner ci` を使ってください。

### 11.4 React Router のルートが列挙されない

- `--client-framework react-router` が必要な可能性があります。
- `app/` または `app/routes/` 構成を確認してください。

## 12. 関連文書

- [CI ガイド](./ci-guide.md)
- [ツール機能詳細](./tool-features.md)
- [Timeline Sandbox 実装方針](./timeline-sandbox-implementation-plan.md)
