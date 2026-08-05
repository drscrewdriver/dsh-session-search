/**
 * Cross-agent session full-text search for DeepSeek Harness.
 *
 * Indexes past conversations from dsh, Codex, Claude Code, pi, and OpenCode
 * into a local SQLite FTS5 (trigram) index and exposes two model-facing tools:
 *
 * - `agent_session_search` — full-text search across indexed sessions, grouped
 *   by session, returning the strongest match, a snippet, and a message window.
 * - `agent_session_read` — read one session's metadata and a message window.
 *
 * Everything is read-only: source artifacts are only opened for reading
 * (opencode.db is opened with `query_only`), and the index lives in its own
 * database file under the harness home.
 *
 * @module @dsh-external/dsh-session-search
 */
import type { Context } from 'cordis';
import z from 'schemastery';
import { type SourceRoots } from './discovery.js';
import type { AgentSource } from './types.js';
/** Cordis plugin name used by Loader diagnostics. */
export declare const name = "dsh-session-search";
/** Capability services required by the model-facing consumer. */
export declare const inject: string[];
/** Default maximum sessions returned by one search call. */
export declare const DEFAULT_MAX_RESULTS = 10;
/** Default window size for session reads. */
export declare const DEFAULT_READ_WINDOW = 10;
/** Default index database location under the harness home. */
export declare function defaultDbPath(): string;
/** Deployment-owned configuration. */
export interface Config {
    /** Index database path. Defaults to `$DSH_HOME/session-search.db`. */
    dbPath?: string;
    /** Source families enabled for indexing. Defaults to all five. */
    sources?: Partial<Record<AgentSource, boolean>>;
    /** Per-source root overrides (defaults resolve under the home dir). */
    roots?: SourceRoots;
    /** Maximum sessions returned by one `agent_session_search` call. Defaults to 10. */
    maxResults?: number;
    /** Maximum session-ranked database rows considered by one search. Defaults to 1000. */
    maxMatchRows?: number;
    /** Window size for `agent_session_read` and search windows. Defaults to 10. */
    readWindow?: number;
    /** Re-index before each search so fresh sessions are visible. Defaults to true. */
    indexOnSearch?: boolean;
}
/** Schemastery config for Loader defaults and generated configuration docs. */
export declare const Config: z<Config>;
/** Register the search tools and their shared model guidance. */
export declare function apply(ctx: Context, config: Config): void;
