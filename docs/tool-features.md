# call-liner ツール機能詳細（現行実装）

この文書は、`/apps/call-liner` の現行 CLI・サンドボックス機能を実装ベースで整理したものです。

## 1. ツール全体でできること

### 1.1 通常 CLI（`pnpm dev -- ...`）

- TypeScript/TSX エントリを静的解析してレポート出力する。
- エントリポイント一覧（`report/entrypoints.json`）を生成する。
- `-d` でデバッグ AST を出力する。
- `--ast-json` で集約 AST とアクション空間/攻撃 DSL を出力する。
- `--client-framework` / `--resource-framework` で解析戦略（`generic` / `react-router`）を切り替える。

### 1.2 サンドボックス CLI（`pnpm --filter call-liner sandbox:run -- ...`）

- `loader` を関数レベルで直接実行する（HTTP サーバ起動不要）。
- CookieJar/仮想時刻/trace を状態として持ち、再現可能に実行する。
- `advance_time`（時間ジャンプ）と `replay`（過去リクエスト再送）で時系列検証を行う。
- OAuth 2-step（authorize -> callback）を連続実行して `state` の正常/改ざん/欠落などを検証する。
- fetch / session / redirect / DB クライアントをスタブ注入できる。

---

## 2. 通常 CLI 引数

対象: `apps/call-liner/src/cli/parse-cli-args.ts`

必須:

- `--client-entry <path>`

任意:

- `-d`
- `--ast-json`
- `--resource-entry <path>`
- `--client-framework <generic|react-router>`
- `--resource-framework <generic|react-router>`

エラー例:

- `--client-entry` 未指定
  - `使い方: tsx src/index.ts [-d] [--ast-json] --client-entry <path> ...`
- framework に未知値を指定
  - framework parser 側でエラー

---

## 3. サンドボックス CLI 引数

対象: `apps/call-liner/src/sandbox/run-sandbox.ts`

### 3.1 シナリオ

- `single`（既定）
  - 1つの loader に対して request / advance_time / replay を順次実行
- `oauth-two-step`
  - authorize loader -> callback loader を連続実行

`--scenario oauth-two-step` を明示しない場合でも、oauth 専用引数が含まれると内部的に oauth_two_step 扱いになる。

### 3.2 `single` 用引数

必須:

- `--loader-file <path>`
- `--url <request-url>`

任意:

- `--method <HTTP method>`（既定 `GET`）
- `--request-id <id>`（既定 `initial`）
- `--advance-ms <int>`（複数指定可）
- `--replay <request-id|operation-index>`（複数指定可）
- `--session key=value`（複数指定可）
- `--env key=value`（複数指定可）
- `--database-strategy <none|memory-client>`（既定 `none`）
- `--database-global <name>`（既定 `db`）
- `--database-model <name>`（複数指定可）
- `--stub-refresh-token <token>`

### 3.3 `oauth-two-step` 用引数

必須:

- `--authorize-loader-file <path>`
- `--callback-loader-file <path>`
- `--authorize-url <request-url>`
- `--callback-url-base <request-url>`

任意:

- `--callback-code <code>`（既定 `sandbox-code`）
- `--state-mode <match_authorize|tampered|missing|fixed>`（既定 `match_authorize`）
- `--callback-state <state>`（`fixed` では実質必須）
- `--state-fuzzing`（OAuth 攻撃ケースを自動生成）
- `--graph-explore`（action 順序 + 状態/時間/外部応答の探索）
- `--spec-validate`（副作用ベースで仕様違反を vulnerability として検出）
- `--refresh-loader-file <path>`（graph exploration 用の refresh loader）
- `--refresh-url <request-url>`（`--refresh-loader-file` 指定時必須）
- `--state-expiry-ms <int>`（`callback_after_expiry` の経過時間、既定 `610000`）
- `--session key=value`
- `--env key=value`
- `--database-strategy <none|memory-client>`
- `--database-global <name>`
- `--database-model <name>`
- `--stub-refresh-token <token>`

制約:

- oauth-two-step では `--advance-ms` / `--replay` は使用不可。
- oauth-two-step では single 専用引数（`--loader-file`, `--url`, など）混在不可。
- `--refresh-loader-file` を使う場合は `--refresh-url` が必須。

### 3.4 `state-fuzzing` / `graph-explore` の挙動

- `--state-fuzzing`:
  - OAuth callback 攻撃ケースを自動生成して順次実行する。
  - 生成される attack id:
    - `missing_state`
    - `replay_state`
    - `different_state`
    - `double_callback`
    - `callback_before_authorize`
    - `callback_after_expiry`
  - 出力 `steps[]` には各 step の `effects`（fetch/cookie/db 副作用サマリ）が含まれる。
- `--graph-explore`:
  - action 順序の順列に加え、状態/時間/外部応答を含む拡張パスも探索する。
  - `--refresh-loader-file` なし: `authorize/callback` の 2 順列
  - `--refresh-loader-file` あり: `authorize/callback/refresh` の 6 順列
  - 追加される stateful extension:
    - `authorize -> callback -> callback`（callback replay）
    - `authorize -> advance_time -> callback`（expiry 後 callback）
    - `authorize -> callback(fetch:invalid_grant)`（token endpoint 失敗応答）
- `--spec-validate`:
  - reject 必須ケースで「認証副作用」が発生した場合を `vulnerability` として出力する。
  - 判定対象の副作用:
    - token endpoint fetch
    - `Set-Cookie`（`cookie_set`）
    - DB write（`memory-client` の `upsert/create/update/delete` など）
  - HTTP status のみでは判定しない（`302` でも副作用が無ければ許容）。

---

## 4. スタブ/注入の仕様

### 4.1 fetch スタブ

型:

- `matcher`: `string | RegExp | (url, init) => boolean`
- `response`: `Response | (url, init) => Response | Promise<Response>`

マッチ仕様:

- `string`: `startsWith` 判定
- `RegExp`: `test(url)`
- 関数: 戻り値をそのまま採用

未一致時:

- 実行停止: `Fetch stub not found for URL: <url>`

デフォルト OAuth 用スタブ:

- `https://github.com/login/oauth/access_token`
- `https://api.github.com/user`
- `--stub-refresh-token` 指定時のみ token レスポンスに `refresh_token` を付与

### 4.2 session/redirect 注入

route loader ロード時に以下を注入:

- `redirect(url, init?)`
- `getSession(request)`
- `commitSession(session, options?)`
- `globals`（任意のグローバル依存）

`--session key=value` はメモリ Map に初期投入され、`getSession().get/set` で参照される。

### 4.3 DB スタブ戦略

- `none`: DB グローバル未注入
- `memory-client`: 指定 global 名に擬似クライアントを注入

`memory-client` で提供される delegate メソッド:

- `upsert`, `create`, `update`, `findUnique`, `findFirst`, `findMany`, `delete`

補足:

- oauth-two-step の `--spec-validate` は `memory-client` 使用時に DB operation も副作用判定へ取り込む。

`memory-client` 注意点:

- `--database-model` を1つ以上指定しないとエラー
  - `memory-client strategy requires at least one --database-model value`

---

## 5. サンドボックス検査（成功/エラー）

### 5.1 実行中に記録される trace

- `request`（loader 呼び出し）
- `fetch`（外部 API 呼び出し）
- `response`（loader 応答）
- `cookie_set`
- `time_advanced`
- `cookie_expired`
- `replay`

### 5.2 Cookie/時刻検査

- `Date.now()` は sandbox の `nowMs` に固定される。
- `Set-Cookie` は CookieJar に反映される。
- `advance_time` 実行時に期限切れ cookie は削除され、`cookie_expired` を記録する。

### 5.3 replay 検査

- `replay` は過去 request を ID または operation index で再実行する。
- 未知の replay target はエラー。

エラー例:

- `Replay target request id was not found: missing-target`
- `Replay target operation index was not found: 99`

### 5.4 `advance_time` バリデーション

- `ms` と `atMs` の同時指定は禁止。
- どちらも未指定も禁止。

エラー例:

- `advance_time requires either ms or atMs, but both were provided`
- `advance_time requires ms or atMs`

### 5.5 CLI 入力バリデーション（代表）

- `Missing value for --flag`
- `Expected key=value for --env, but received: ...`
- `Expected integer milliseconds for --advance-ms`
- `Unknown argument: ...`
- `Unknown scenario: ... Expected one of single, oauth-two-step`
- `Unknown state mode: ... Expected one of match_authorize, tampered, missing, fixed`
- `Missing required argument: --loader-file <path>`
- `Missing required argument: --callback-loader-file <path>`
- `Missing required argument: --refresh-url <request-url> when --refresh-loader-file is used`

### 5.6 route loader ロード時の検査

- `loader` export が無い route module は失敗。

エラー例:

- `loader export was not found in route module: <absolute-path>`

---

## 6. スタブ付き実行スタブ（テンプレ）

### 6.1 single

```bash
pnpm --filter call-liner sandbox:run -- \
  --loader-file /abs/path/callback.tsx \
  --url "https://app.test/auth/github/callback?code=test&state=s1" \
  --request-id callback \
  --session "oauth:state=s1" \
  --env "GITHUB_CLIENT_ID=dummy-client-id" \
  --env "GITHUB_CLIENT_SECRET=dummy-client-secret" \
  --advance-ms 1000 \
  --replay callback
```

### 6.2 oauth-two-step

```bash
pnpm --filter call-liner sandbox:run -- \
  --scenario oauth-two-step \
  --authorize-loader-file /abs/path/authorize.tsx \
  --callback-loader-file /abs/path/callback.tsx \
  --authorize-url "https://app.test/auth/github" \
  --callback-url-base "https://app.test/auth/github/callback" \
  --state-mode tampered \
  --env "GITHUB_CLIENT_ID=dummy-client-id" \
  --env "GITHUB_CLIENT_SECRET=dummy-client-secret"
```

---

## 7. 出力 JSON の形

### 7.1 single

```json
{
  "steps": [
    { "type": "request", "id": "callback", "status": 200, "location": null, "body": "ok" },
    { "type": "advance_time", "fromMs": 1700000000000, "toMs": 1700000001000 },
    { "type": "replay", "target": "callback", "status": 409, "location": null, "body": "replay" }
  ],
  "cookieJar": {},
  "trace": [
    { "type": "request", "url": "...", "method": "GET" },
    { "type": "time_advanced", "fromMs": 1700000000000, "toMs": 1700000001000 },
    { "type": "replay", "target": "callback", "url": "...", "method": "GET" }
  ]
}
```

### 7.2 oauth-two-step

```json
{
  "steps": [
    {
      "type": "authorize",
      "requestUrl": "https://app.test/auth/github",
      "status": 302,
      "location": "https://github.com/login/oauth/authorize?...&state=state-1",
      "state": "state-1",
      "body": "",
      "effects": {
        "fetchCount": 0,
        "tokenEndpointFetchCount": 0,
        "cookieSetNames": [],
        "dbWriteCount": 0,
        "dbOperations": []
      }
    },
    {
      "type": "callback",
      "requestUrl": "https://app.test/auth/github/callback?code=sandbox-code&state=state-1",
      "status": 200,
      "location": null,
      "state": "state-1",
      "body": "ok",
      "effects": {
        "fetchCount": 2,
        "tokenEndpointFetchCount": 1,
        "cookieSetNames": ["session"],
        "dbWriteCount": 1,
        "dbOperations": [{ "model": "user", "operation": "upsert" }]
      }
    }
  ],
  "callbackRequest": {
    "url": "https://app.test/auth/github/callback?code=sandbox-code&state=state-1",
    "method": "GET"
  },
  "cookieJar": {},
  "trace": []
}
```

### 7.3 oauth-two-step + state-fuzzing + spec-validate

```json
{
  "steps": [],
  "callbackRequest": { "url": "https://app.test/auth/github/callback?code=sandbox-code&state=state-1", "method": "GET" },
  "fuzzing": {
    "attacks": [
      { "id": "missing_state", "title": "missing state", "steps": [], "violations": [] },
      { "id": "different_state", "title": "different state", "steps": [], "violations": [] }
    ],
    "vulnerabilities": [
      {
        "attackId": "different_state",
        "ruleId": "state_mismatch_must_reject",
        "expected": "no auth side effects (token fetch / cookie set / db write)",
        "actualStatus": 200,
        "observedSideEffects": ["cookie set: session"],
        "stepType": "callback",
        "vulnerability": true
      }
    ]
  },
  "cookieJar": {},
  "trace": []
}
```

### 7.4 oauth-two-step + graph-explore

```json
{
  "steps": [],
  "callbackRequest": { "url": "https://app.test/auth/github/callback?code=sandbox-code&state=state-1", "method": "GET" },
  "graphExploration": {
    "paths": [
      {
        "id": "graph:authorize->callback->refresh",
        "kind": "order_permutation",
        "order": ["authorize", "callback", "refresh"],
        "steps": [],
        "violations": []
      },
      {
        "id": "graph:stateful:callback_replay",
        "kind": "stateful_extension",
        "order": ["authorize", "callback", "callback"],
        "steps": [],
        "violations": []
      },
      {
        "id": "graph:stateful:token_invalid_grant",
        "kind": "stateful_extension",
        "order": ["authorize", "callback(fetch:invalid_grant)"],
        "steps": [],
        "violations": []
      }
    ],
    "vulnerabilities": []
  },
  "cookieJar": {},
  "trace": []
}
```
