/**
 * SQLite FTS5 (trigram) index and query layer for cross-agent session search.
 *
 * Mirrors the schema proven by pi's session-search extension: a `sessions`
 * table for metadata, a `messages` table for normalized messages, and an
 * FTS5 virtual table (trigram tokenizer) for substring search — including
 * CJK, which unicode61 cannot match. Indexing is incremental: artifacts whose
 * (mtime, size) are unchanged since the last pass are skipped.
 * @module @dsh-external/dsh-session-search/db
 */
import type { AgentMessageRecord, AgentSearchHit, AgentSessionRecord, AgentSource } from './types.js';
/** Current derived-index schema version; incompatible versions reset in place. */
export declare const SESSION_SEARCH_SCHEMA_VERSION = 3;
/** One search request against the index. */
export interface SearchRequest {
    /** Full-text query, interpreted as data (never raw FTS syntax). */
    query: string;
    /** Source families to restrict to; empty means all indexed sources. */
    sources?: readonly AgentSource[];
    /** Role filter; empty means user + assistant. */
    roles?: readonly AgentMessageRecord['role'][];
    /** Working-directory substring filter. */
    cwd?: string;
    /** Maximum sessions returned. */
    limit: number;
    /** Ordering of the result sessions. */
    sort?: 'relevance' | 'newest' | 'oldest';
    /** Number of messages returned around each best match. */
    window?: number;
}
/** One search hit: session, strongest message, snippet, and window. */
export interface SearchHit extends AgentSearchHit {
    /** Messages surrounding the best match, in seq order. */
    window: AgentMessageRecord[];
}
/** Database-owned resource bounds. */
export interface SessionSearchDbOptions {
    /** Maximum session-ranked rows materialized by one search. */
    maxMatchRows?: number;
}
/** Default maximum number of session-ranked rows materialized by one search. */
export declare const DEFAULT_MAX_MATCH_ROWS = 1000;
/** Incremental index over discovered session artifacts. */
export declare class SessionSearchDb {
    private readonly enabled;
    private readonly db;
    private readonly maxMatchRows;
    /** Serialized indexing pass; only one runs at a time. */
    private indexing;
    constructor(path: string, enabled: ReadonlySet<AgentSource>, options?: SessionSearchDbOptions);
    /** Create or migrate the derived index without dropping tables used by older live readers. */
    private ensureSchema;
    /** Serialize one indexing pass over the given artifact list. */
    index(artifacts: Array<{
        source: AgentSource;
        path: string;
    }>): Promise<number>;
    /** The single indexing pass: upsert changed artifacts, drop vanished ones. */
    private runIndex;
    /** Atomically replace every indexed session owned by one artifact. */
    private replaceArtifact;
    /** Remove every session and message owned by one artifact. */
    private dropArtifact;
    /** Remove one session and its mirrored FTS rows. */
    private dropSession;
    private key;
    /**
     * Run a full-text search and return session-grouped hits.
     * @param request - normalized search request.
     * @returns hits with message windows, in requested order.
     */
    search(request: SearchRequest): SearchHit[];
    /** Build one hit from a query row. */
    private hitFromRow;
    /** Messages of one session in seq order. */
    sessionMessages(source: AgentSource, sessionId: string): AgentMessageRecord[];
    /** Messages around a message seq within a session. */
    private windowAround;
    /** Read one session's metadata and a message window. */
    readSession(source: AgentSource, sessionId: string, aroundSeq?: number, window?: number): {
        session: AgentSessionRecord | undefined;
        messages: AgentMessageRecord[];
    };
    /** List sessions in the index, newest first. */
    listSessions(limit?: number): AgentSessionRecord[];
    /** Close the database handle. */
    close(): void;
}
