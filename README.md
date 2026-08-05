# @dsh-external/dsh-session-search

跨工具会话全文搜索插件（DeepSeek Harness 外部插件）——索引并搜索本机 dsh、Codex、Claude Code、pi、OpenCode 的历史会话。

[English](README.en.md)

## 能力

| 工具 | 说明 |
|---|---|
| `agent_session_search` | 跨源全文搜索：命中会话 + 最强消息 + snippet + 消息窗口；支持 `sources`/`cwd`/`sort`/`limit` 过滤 |
| `agent_session_read` | 读取单个索引会话的元数据与消息窗口（`aroundSeq` 定位） |

全文检索基于 SQLite FTS5 **trigram** 分词：中英文子串均可匹配（unicode61 无法匹配中文子串）。

## 支持的会话源

| 源 | 位置（默认） | 读取方式 |
|---|---|---|
| dsh | `~/.dsh/sessions/**/session.jsonl.zstd` | 多帧 zstd 按帧解压（node:zlib 原生） |
| codex | `~/.codex/sessions/**` + `archived_sessions/` | JSONL |
| claude | `~/.claude/projects/**` | JSONL |
| pi | `~/.pi/agent/sessions/**` | JSONL |
| opencode | `~/.local/share/opencode/opencode.db` | SQLite 只读（`readOnly`） |

所有源**只读**：不修改任何会话文件；索引存放在独立数据库 `$DSH_HOME/session-search.db`。

## 安装（marisa / dshx）

```sh
git clone https://github.com/dsh-external/dsh-session-search.git
dshx install dsh-session-search ./dsh-session-search
```

或直接按 git-url 安装。安装后插件自动挂载进 `~/.dsh/config.yaml`，`dsh web`/TUI 下次启动生效（Web 面 HMR 启用时热生效）。

### 手动挂载（无 dshx）

```yaml
# ~/.dsh/config.yaml
- insert:
    - id: dsh-session-search
      name: '/absolute/path/to/dsh-session-search/lib/index.js'
      config:
        dbPath: ~/.dsh/session-search.db
        sources: { dsh: true, codex: true, claude: true, pi: true, opencode: true }
        maxResults: 10
        readWindow: 10
        indexOnSearch: true
```

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `dbPath` | `$DSH_HOME/session-search.db` | 索引数据库路径 |
| `sources` | 全部启用 | 每源布尔开关（`dsh`/`codex`/`claude`/`pi`/`opencode`） |
| `roots` | 各源默认主目录 | 每源根目录覆盖 |
| `maxResults` | 10 | 单次搜索返回的最大会话数 |
| `readWindow` | 10 | `agent_session_read` 默认窗口大小 |
| `indexOnSearch` | true | 搜索前自动增量补索引（新会话立即可搜） |

## 模型提示

安装后注入系统提示：

> Use agent_session_search to find relevant work from prior sessions across dsh,
> Codex, Claude Code, pi, and OpenCode, then agent_session_read to view a full
> message window of one hit...

## 开发

```sh
./scripts/build.sh   # 用 dsh checkout 的 tsc 编译 src → lib（lib/ 提交进 git）
node tests/smoke.mjs # 冒烟测试：索引真实会话并搜索
```

peerDependencies 由宿主 dsh 的 node_modules 提供（`cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-system-prompt` 等），构建脚本会建立符号链接。

## 实现要点

- 解析器防御式处理：超大/损坏/不可读文件跳过，单文件失败不影响整体索引。
- dsh 会话日志是**拼接帧 zstd 流**（每批事件一个独立帧）：先结构化扫描帧边界再逐帧解压；撕裂的末帧（写入中断）跳过，下次索引补上。
- 增量索引：按 `(mtime, size)` 跳过未变文件；消失的会话自动清理。
- FTS 同步显式按 rowid 维护（FTS5 `'delete'` 特殊命令在部分 SQLite 构建上不可靠）。
- 短查询（<3 个可搜索字符）退化为 LIKE 精确匹配，snippet 回退为命中消息正文。

## License

BSD-3-Clause
