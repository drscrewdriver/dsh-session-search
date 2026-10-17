# dsh-session-search

Cross-agent session search plugin for DeepSeek Harness — directly scan past conversations from dsh, Codex, Claude Code, pi, and OpenCode without creating a derived database.

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

> **Compatibility note:** v0.1.0 ships Japanese (`ja`) and Korean (`ko`) dictionaries, but the current official DSH releases expose only `zh` and `en` through `LocaleRuntime`. On stock DSH, selecting `ja` or `ko` fails with `locale "<id>" is not registered`.
>
> **Host compatibility:** tested DSH hosts are listed as an exact per-rc enumeration (no ranges/caret) in `engines.dsh` and every `@deepseek-ai/dsh-*` peer: `0.1.0-rc.2 || 0.1.0-rc.3 || 0.1.0-rc.6 || 0.1.0-rc.7 || 0.1.0-rc.8 || 0.1.1-rc.1 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.5-rc.3 || 0.1.7-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1`.

## Capabilities

| Tool | Description |
|---|---|
| `agent_session_search` | Case-insensitive literal search across current source artifacts: matching session + strongest message + snippet + message window; supports `sources`/`cwd`/`sort`/`limit` filters |
| `agent_session_read` | Read one discovered session's metadata and a message window (`aroundSeq` targeting) |

Search observes the current source artifacts on each call and uses a case-insensitive literal substring match. English, Chinese, punctuation, and short queries all follow the same rule. Relevance is intentionally basic: the message with the most occurrences represents each session, with recency as the tie-breaker.

## Supported session sources

| Source | Default location | Read mode |
|---|---|---|
| dsh | `~/.dsh/sessions/**/session.jsonl.zstd` | multi-frame zstd, decoded frame by frame (node:zlib native) |
| codex | `~/.codex/sessions/**` + `archived_sessions/` | JSONL |
| claude | `~/.claude/projects/**` | JSONL |
| pi | `~/.pi/agent/sessions/**` | JSONL |
| opencode | `~/.local/share/opencode/opencode.db` | SQLite read-only |

All sources are **read-only**: session files are never modified, and the plugin creates no database, index, or persistent cache. OpenCode's own database is opened read-only as a source artifact.

## Install (marisa / dshx)

```sh
git clone https://github.com/Tieboyh/dsh-session-search.git
dshx install dsh-session-search ./dsh-session-search
```

Or install directly from a git URL. The plugin is mounted into `~/.dsh/config.yaml` and takes effect on the next `dsh web`/TUI start (hot with Web HMR).

### Manual mount (without dshx)

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

## Development

```sh
./scripts/build.sh   # compile src → lib with the dsh checkout's tsc (lib/ committed)
node tests/smoke.mjs # smoke test: scan real sessions and search
```

peerDependencies are provided by the host dsh's node_modules (`cordis`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-system-prompt`, …); the build script creates the symlinks.

## Implementation notes

- Parsers are defensive: oversized, corrupt, or unreadable files are skipped without failing the whole scan.
- dsh session logs are **concatenated-frame zstd streams** (one independent frame per appended event batch): frame boundaries are located with a structural scan, then decoded one frame at a time; a torn final frame (interrupted write) is skipped on that call.
- `sources` is applied before discovery. For canonical plain JSONL sources, safe single-line queries use `rg --fixed-strings --ignore-case` only to select candidate files; escaped queries skip this optimization. Every candidate is parsed and matched again, so raw metadata never becomes a result.
- Search processes one parsed session at a time and retains only bounded Top-K hits. DSH concatenated Zstd frames are decompressed and consumed one frame at a time instead of materializing the complete decoded log.
- `agent_session_read` tries the source-native artifact id first and falls back to a source-scoped scan only when an external format does not expose a direct mapping. OpenCode selects the exact source row.
- Every call observes current source state. There is no index lifecycle or stale derived state; a broad DSH search must still decompress the complete DSH corpus.
- Matching is literal and case-insensitive. Results group by session, rank the strongest message by occurrence count, and use timestamps for stable tie-breaking.

## License

BSD-3-Clause
