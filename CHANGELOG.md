# Changelog

All notable changes to `dsh-session-search` are recorded here.

- [English changelog](./CHANGELOG.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)

## 0.1.1 — 2026-10-17

### Changed

- Manifest-only release: dropped the placeholder `@dsh-external` npm scope (published as `dsh-session-search`, matching sibling plugins).
- `engines.dsh` and all `@deepseek-ai/dsh-*` peers rewritten from open ranges/carets to an exact per-rc host enumeration (16 entries, through `0.2.1-rc.1`), satisfying the dual-manifest exact-enum discipline.
- Pinned `publishConfig.registry` to `https://registry.npmjs.org`; README now states the tested host enumeration.

## 0.1.0 — 2026-08-18

### Added

- Initial release: index-free cross-agent session search supporting dsh, Codex, Claude Code, pi, and OpenCode sources.
- `agent_session_search` tool: case-insensitive literal search across session sources with source/cwd/sort/limit filters.
- `agent_session_read` tool: read session metadata and message window with `aroundSeq` targeting.
- Defensive parsers: oversized, corrupt, or unreadable files are skipped without failing the scan.
- dsh concatenated-frame zstd stream support: frame-boundary structural scan, per-frame decompression.
- System prompt injection for model guidance.
