# @dsh-external/dsh-session-search

Cross-agent session full-text search plugin for DeepSeek Harness — index and search past conversations from dsh, Codex, Claude Code, pi, and OpenCode.

## Capabilities

| Tool | Description |
|---|---|
| `agent_session_search` | Full-text search across indexed sessions: matching session + strongest message + snippet + message window; supports `sources`/`cwd`/`sort`/`limit` filters |
| `agent_session_read` | Read one indexed session's metadata and a message window (`aroundSeq` targeting) |

Full-text search uses SQLite FTS5 **trigram** tokenization: both English and Chinese substrings match (unicode61 cannot match CJK substrings).

## Supported session sources

| Source | Default location | Read mode |
|---|---|---|
| dsh | `~/.dsh/sessions/**/session.jsonl.zstd` | zstd decompression (node:zlib native) |
| codex | `~/.codex/sessions/**` + `archived_sessions/` | JSONL |
| claude | `~/.claude/projects/**` | JSONL |
| pi | `~/.pi/agent/sessions/**` | JSONL |
| opencode | `~/.local/share/opencode/opencode.db` | SQLite read-only |

All sources are **read-only**: session files are never modified; the index lives in its own database at `$DSH_HOME/session-search.db`.

## Install (marisa / dshx)

```sh
git clone https://github.com/dsh-external/dsh-session-search.git
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
        dbPath: ~/.dsh/session-search.db
        sources: { dsh: true, codex: true, claude: true, pi: true, opencode: true }
        maxResults: 10
        readWindow: 10
        indexOnSearch: true
```

## Configuration

| Key | Default | Description |
|---|---|---|
| `dbPath` | `$DSH_HOME/session-search.db` | Index database path |
| `sources` | all enabled | Per-source boolean switch (`dsh`/`codex`/`claude`/`pi`/`opencode`) |
| `roots` | per-source home defaults | Per-source root override |
| `maxResults` | 10 | Max sessions per search |
| `readWindow` | 10 | Default window for `agent_session_read` |
| `indexOnSearch` | true | Incremental re-index before each search |

## Development

```sh
./scripts/build.sh   # compile src → lib with the dsh checkout's tsc (lib/ committed)
node tests/smoke.mjs # smoke test: index real sessions and search
```

peerDependencies are provided by the host dsh's node_modules (`cordis`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-system-prompt`, …); the build script creates the symlinks.

## Implementation notes

- Parsers are defensive: oversized/corrupt/unreadable files are skipped without failing the whole index.
- Incremental indexing skips unchanged files by `(mtime, size)`; vanished sessions are cleaned up.
- FTS sync is maintained explicitly by rowid (the FTS5 `'delete'` special command is unreliable on some SQLite builds).
- Short queries (<3 searchable chars) fall back to LIKE exact matching.

## License

BSD-3-Clause
