# 安装指南

- [安装指南](./INSTALL.zh.md)
- [English installation guide](./INSTALL.md)
- [日本語インストールガイド](./INSTALL.ja.md)
- [한국어 설치 안내](./INSTALL.ko.md)
- [中文 README](./README.zh-CN.md)
- [English README](./README.md)
- [日本語 README](./README.ja.md)
- [한국어 README](./README.ko.md)
- [版本更新日志](./CHANGELOG.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)

## 安装（marisa / dshx）

```sh
git clone https://github.com/Tieboyh/dsh-session-search.git
dshx install dsh-session-search ./dsh-session-search
```

或直接按 git-url 安装。安装后插件自动挂载进 `~/.dsh/config.yaml`，`dsh web`/TUI 下次启动生效（Web 面 HMR 启用时热生效）。

## 手动挂载（无 dshx）

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

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `sources` | 全部启用 | 每源布尔开关 |
| `roots` | 各源默认主目录 | 每源根目录覆盖 |
| `maxResults` | 10 | 单次搜索返回的最大会话数 |
| `readWindow` | 10 | `agent_session_read` 默认窗口大小 |

## 卸载

从 `~/.dsh/config.yaml` 移除条目并重启 `dsh web`。
