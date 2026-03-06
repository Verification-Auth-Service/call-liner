# Timeline Sandbox 実装方針（ドラフト）

## 目的

- `apps/call-liner-app` を React UI として実装し、OAuth/Session フローを「時間軸付き」で探索できるようにする。
- 既存のユニットテスト/E2Eとは別レイヤとして、`loader/action` 関数レベル実行で反例探索を行う。
- PR を巨大化させないため、段階的に価値を出す。

## 位置づけ

- ユニットテスト: 局所ロジックの正しさ
- E2E: 実統合の回帰確認
- タイムラインサンドボックス: 時間・外部I/O・状態を制御した性質検証（反例探索）

## スコープ（最初の対象）

- 対象フロー: OAuth callback を中心にした `loader/action`
- 実行単位: HTTP 丸ごとではなく、`loader({ request, ... })` / `action(...)` の関数レベル呼び出し
- 対象能力:
  - `request.url` / query / cookie / body の任意生成
  - `Date.now` 相当の制御
  - `fetch` / DB / session API の差し替え
  - リプレイ・時間ジャンプ・分岐

## 実行モデル（動画編集タイムライン）

タイムラインのクリップを `Operation` として扱う。

- `Request(routeId, method, url, headers, cookies, body, mutations)`
- `AdvanceTime(ms | at)`
- `SetEnv(key, value)`
- `StubFetch(pattern, responseModel)`
- `Replay(target)`
- `Parallel(ops[])`
- `Assert(policyId | predicate)`

## サンドボックス VM の中核インターフェース

```ts
export type SandboxState = {
  clock: ClockState;
  cookieJar: CookieJarState;
  sessionStore: SessionStoreState;
  db: DbState;
  stubs: StubState;
  trace: TraceEvent[];
};

export type SandboxOperation =
  | RequestOp
  | AdvanceTimeOp
  | SetEnvOp
  | StubFetchOp
  | ReplayOp
  | ParallelOp
  | AssertOp;

export type SandboxRunner = (
  op: SandboxOperation,
  state: SandboxState,
) => Promise<{ next: SandboxState; event: TraceEvent }>;
```

## 静的解析の最小出力（攻撃 DSL 生成用）

初期段階では、完全評価を狙わず以下のみ抽出する。

- `export loader/action` の列挙
- `new URL(request.url)` + `searchParams.get("...")` から入力キー抽出
- `getSession` + `session.get/set("...")` から状態キー抽出
- `fetch(...)` の宛先と主要 body キー抽出
- `redirect(...)` の遷移先抽出（不明なら external ラベル）
- 主要 guard 条件の列挙（欠落・不一致・型不正）

これを元に、攻撃/操作列を自動生成する。

- query `code/state` 欠落
- `state` 改ざん
- cookie 欠落（session 空）
- token/user endpoint 異常（stub）
- `expires_in` 極端値（stub）
- callback の同一 code リプレイ
- `AdvanceTime` による期限超過

## 反例探索の判定基準（独立オラクル）

実装依存の「都合のよいモック」ではなく、固定ポリシーで判定する。

- `state` 必須・一致必須
- verifier 必須
- token/user 失敗時の安全な遷移
- 期限超過時の cookie/session 無効化
- code リプレイ時の拒否
- 機微情報の不用意保存・露出の不在

## 段階的実装（PR分割前提）

1. Phase 1: callback 単体の関数レベルサンドボックス
2. Phase 2: `AdvanceTime` + CookieJar 期限モデル + replay
3. Phase 3: 静的解析出力から攻撃 DSL 自動生成
4. Phase 4: authorize + callback の2ステップ探索
5. Phase 5: React タイムライン UI（`apps/call-liner-app`）

## `apps/call-liner-app` 実装方針

- まず UI 先行ではなく VM/API を先に固定する（再現性を優先）
- UI は次の 4 ペイン最小構成から開始する
  - クリップ一覧
  - タイムライン
  - インスペクタ（選択 operation 詳細）
  - 状態ビュー（CookieJar/Session/Trace）
- 最初は JSON タイムライン（EDL相当）を読み込むだけでよい

## 直近 TODO（最小セット）

1. `apps/call-liner` 側に VM パッケージ雛形を追加
2. callback loader を直接呼ぶ実行ハーネスを追加
3. clock/cookie/session/fetch stub の最小実装を追加
4. `AdvanceTime` と replay のテストを追加
5. React app (`apps/call-liner-app`) を作成し、JSON タイムライン再生 UI を接続

## 完了条件（MVP）

- callback フローで、`missing_state` / `tampered_state` / `replay` / `expiry` を `Operation` 列で再現できる
- 反例が見つかったら、再生可能な trace と状態差分を出力できる
- 同じタイムラインを再実行したとき、結果が再現する（deterministic）
