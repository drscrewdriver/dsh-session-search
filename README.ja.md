# dsh-session-search

DeepSeek Harness 向けのクロスエージェント会話検索プラグイン——派生データベースを作成せず、ローカルの dsh、Codex、Claude Code、pi、OpenCode の過去会話を直接スキャンします。

- [English README](./README.md)
- [中文 README](./README.zh-CN.md)
- [日本語 README](./README.ja.md)
- [한국어 README](./README.ko.md)
- [Installation guide](./INSTALL.md)
- [中文安装指南](./INSTALL.zh.md)
- [日本語インストールガイド](./INSTALL.ja.md)
- [한국어 설치 안내](./INSTALL.ko.md)
- [Changelog](./CHANGELOG.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)

> **互換性について：** `ja` と `ko` の辞書は同梱されていますが、現在の公式 DSH リリースは `LocaleRuntime` 経由で `zh` と `en` のみを提供しています。純正 DSH で `ja` または `ko` を選択すると `locale "<id>" is not registered` で失敗します。
>
> **ホスト互換性：** テスト済みの DSH ホストは区間/caret なしの逐 rc 正確列挙として `engines.dsh` とすべての `@deepseek-ai/dsh-*` peer に記載：`0.1.0-rc.2 || 0.1.0-rc.3 || 0.1.0-rc.6 || 0.1.0-rc.7 || 0.1.0-rc.8 || 0.1.1-rc.1 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.5-rc.3 || 0.1.7-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1`。

## 能力

| ツール | 説明 |
|---|---|
| `agent_session_search` | 現在のソースアーティファクトに対して大文字小文字を区別しないリテラル検索：一致セッション + 最強メッセージ + スニペット + メッセージウィンドウ；`sources`/`cwd`/`sort`/`limit` フィルタサポート |
| `agent_session_read` | 発見したセッションのメタデータとメッセージウィンドウを読み取り（`aroundSeq` ターゲティング） |

検索は各呼び出しで現在のソースアーティファクトを観察し、大文字小文字を区別しないリテラル部分文字列マッチを実行します。

## サポートされているセッションソース

| ソース | デフォルト場所 | 読み取りモード |
|---|---|---|
| dsh | `~/.dsh/sessions/**/session.jsonl.zstd` | マルチフレーム zstd、フレームごとにデコード |
| codex | `~/.codex/sessions/**` + `archived_sessions/` | JSONL |
| claude | `~/.claude/projects/**` | JSONL |
| pi | `~/.pi/agent/sessions/**` | JSONL |
| opencode | `~/.local/share/opencode/opencode.db` | SQLite 読み取り専用 |

すべてのソースは**読み取り専用**：セッションファイルは変更されず、データベース・インデックス・永続キャッシュも作成しません。

## インストール（marisa / dshx）

```sh
git clone https://github.com/Tieboyh/dsh-session-search.git
dshx install dsh-session-search ./dsh-session-search
```

または git URL から直接インストール。`~/.dsh/config.yaml` に自動マウントされ、次の `dsh web`/TUI 起動で有効化。

### 手動マウント（dshx 不使用）

```yaml
# ~/.dsh/config.yaml
- insert:
    - id: dsh-session-search
      name: '/absolute/path/to/dsh-session-search/lib/index.js'
      config:
        sources: { dsh: true, codex: true, claude: true, pi: true, opencode: true }
        maxResults: 10
        readWindow: 10
```

## 設定

| キー | デフォルト | 説明 |
|---|---|---|
| `sources` | すべて有効 | ソースごとのブールスイッチ |
| `roots` | ソースごとのデフォルト | ソースごとのルート上書き |
| `maxResults` | 10 | 1 回の検索で返す最大セッション数 |
| `readWindow` | 10 | `agent_session_read` のデフォルトウィンドウ |

## 実装メモ

- パーサーは防御的：過大・破損・読み取り不可ファイルはスキップ、全スキャンを失敗させません。
- dsh セッションログは**連結フレーム zstd ストリーム**：フレーム境界を構造スキャンで特定し、フレームごとにデコード。
- `sources` はファイル発見前に適用。JSONL ソースでは `rg --fixed-strings --ignore-case` で候補ファイルを選定。
- 検索は 1 つの解析済みセッションずつ処理し、bounded Top-K のみ保持。
- マッチングはリテラルで大文字小文字非依存。結果はセッションごとにグループ化。

## 開発

```sh
./scripts/build.sh   # dsh checkout の tsc で src → lib をコンパイル
node tests/smoke.mjs # スモークテスト
```

## ライセンス

BSD-3-Clause
