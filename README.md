# call-liner

`call-liner` は、認証・認可フロー向けの静的解析、sandbox 実行、CI 品質ゲート実行を行うツールです。

## 前提

- Node.js 20 以上
- pnpm 10 系

## セットアップ

```bash
pnpm install
```


## ドキュメント

- [CLI リファレンス](docs/cli-reference.md)
- [GitHub Actions CI ガイド](docs/ci-guide.md)
- [sample-auth-app で call-liner を動かす導入手順](docs/sample-auth-app-github-actions-setup.md)
- [ツール機能詳細](docs/tool-features.md)
- [Timeline Sandbox 実装方針](docs/timeline-sandbox-implementation-plan.md)

## 開発コマンド

```bash
pnpm typecheck
pnpm test
```
