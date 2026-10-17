# インストールガイド

- [日本語インストールガイド](./INSTALL.ja.md)
- [English installation guide](./INSTALL.md)
- [中文安装指南](./INSTALL.zh.md)
- [한국어 설치 안내](./INSTALL.ko.md)
- [日本語 README](./README.ja.md)
- [English README](./README.md)
- [中文 README](./README.zh-CN.md)
- [한국어 README](./README.ko.md)
- [Changelog](./CHANGELOG.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)

## インストール（marisa / dshx）

```sh
git clone https://github.com/Tieboyh/dsh-session-search.git
dshx install dsh-session-search ./dsh-session-search
```

または git URL から直接インストール。`~/.dsh/config.yaml` に自動マウントされ、次の `dsh web`/TUI 起動で有効化。

## 手動マウント（dshx 不使用）

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

## アンインストール

`~/.dsh/config.yaml` からエントリを削除し `dsh web` を再起動。
