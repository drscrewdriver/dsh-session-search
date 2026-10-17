# Installation Guide

- [English installation guide](./INSTALL.md)
- [中文安装指南](./INSTALL.zh.md)
- [日本語インストールガイド](./INSTALL.ja.md)
- [한국어 설치 안내](./INSTALL.ko.md)
- [English README](./README.md)
- [中文 README](./README.zh-CN.md)
- [日本語 README](./README.ja.md)
- [한국어 README](./README.ko.md)
- [Changelog](./CHANGELOG.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)

## Install (marisa / dshx)

```sh
git clone https://github.com/Tieboyh/dsh-session-search.git
dshx install dsh-session-search ./dsh-session-search
```

Or install directly from a git URL. The plugin is mounted into `~/.dsh/config.yaml` and takes effect on the next `dsh web`/TUI start (hot with Web HMR).

## Manual mount (without dshx)

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

## Configuration

| Key | Default | Description |
|---|---|---|
| `sources` | all enabled | Per-source boolean switch (`dsh`/`codex`/`claude`/`pi`/`opencode`) |
| `roots` | per-source home defaults | Per-source root override |
| `maxResults` | 10 | Max sessions per search |
| `readWindow` | 10 | Default window for `agent_session_read` |

## Uninstall

Remove the entry from `~/.dsh/config.yaml` and restart `dsh web`.
