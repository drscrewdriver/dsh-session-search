/**
 * Per-source session parsers: read one artifact and normalize it into the
 * shared ParsedSession shape.
 *
 * All parsers are defensive: unreadable, oversized, or malformed lines are
 * skipped without failing the whole file. The dsh source decompresses zstd
 * frames with node:zlib (available since Node 22.13). The opencode source
 * opens its SQLite database read-only (PRAGMA query_only) and never writes.
 * @module @dsh-external/dsh-session-search/parsers
 */
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { zstdDecompressSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname } from 'node:path';
/** Per-message content cap kept in the index (long tool dumps stay out). */
export const MAX_MSG_CHARS = 4000;
/** Per-file byte cap; larger artifacts are skipped entirely. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** Per-line byte cap; larger lines are skipped. */
export const MAX_LINE_CHARS = 512 * 1024;
/** Time from a number (ms) or ISO string; 0 when unparsable. */
function tsOf(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const t = Date.parse(value);
        return Number.isNaN(t) ? 0 : t;
    }
    return 0;
}
/** Parse a JSON value defensively; null for anything non-object. */
function asRecord(line) {
    if (line.length > MAX_LINE_CHARS)
        return null;
    let data;
    try {
        data = JSON.parse(line);
    }
    catch {
        return null;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data))
        return null;
    return data;
}
/** Extract plain text from a content block list or string. */
function extractText(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    const parts = [];
    for (const block of content) {
        if (typeof block !== 'object' || block === null)
            continue;
        const b = block;
        if (b.type === 'text' && typeof b.text === 'string')
            parts.push(b.text);
    }
    return parts.join('\n');
}
/** Cap a message body for index storage. */
function cap(s) {
    return s.length > MAX_MSG_CHARS ? s.slice(0, MAX_MSG_CHARS) : s;
}
/** Stream a JSONL file line by line with size guards; resolves false on any failure. */
async function eachLine(path, fn) {
    let st;
    try {
        st = await stat(path);
    }
    catch {
        return;
    }
    if (st.size > MAX_FILE_BYTES)
        return;
    const rl = createInterface({
        input: createReadStream(path, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });
    try {
        for await (const line of rl)
            fn(line);
    }
    catch {
        // unreadable file: skip
    }
    finally {
        rl.close();
    }
}
/** Build the shared ParsedSession shell from tracked fields. */
function parsed(source, path, sessionId, fields) {
    return {
        session: {
            source,
            sessionId,
            path,
            title: fields.title,
            cwd: fields.cwd,
            createdAt: fields.createdAt,
            updatedAt: fields.updatedAt,
            messageCount: fields.messages.length,
            size: 0, // filled by the indexer after stat
            mtime: 0,
        },
        messages: fields.messages,
    };
}
// ------------------------------------------------------------------ dsh
/** Chat event types whose text enters the transcript. */
const DSH_CHAT_TYPES = new Set(['user/message', 'steering/message', 'assistant/message']);
/** Extract the chat text of one dsh event (both content shapes). */
function dshEventText(data) {
    if (data === undefined)
        return '';
    if (Array.isArray(data.content))
        return extractText(data.content);
    const message = data.message;
    if (typeof message === 'object' && message !== null && Array.isArray(message.content)) {
        return extractText(message.content);
    }
    return '';
}
/**
 * Parse one dsh session log (zstd-compressed JSONL). Uses the sync zstd
 * decompressor: logs are small enough that sync decode is fine for indexing.
 */
export async function parseDsh(path) {
    let buffer;
    try {
        buffer = await readFile(path);
    }
    catch {
        return parsed('dsh', path, basename(path).replace(/\.jsonl(\.zstd)?$/, ''), empty());
    }
    if (buffer.byteLength > MAX_FILE_BYTES)
        return parsed('dsh', path, basename(path), empty());
    let text;
    try {
        text = zstdDecompressSync(buffer).toString('utf8');
    }
    catch {
        return parsed('dsh', path, basename(path).replace(/\.jsonl(\.zstd)?$/, ''), empty());
    }
    return parseDshLines(path, text);
}
/** Parse the decompressed dsh JSONL text. */
function parseDshLines(path, text) {
    const messages = [];
    let sessionId = basename(path).replace(/\.jsonl(\.zstd)?$/, '');
    let cwd = '';
    let title = '';
    let createdAt = 0;
    let updatedAt = 0;
    let seq = 0;
    for (const raw of text.split('\n')) {
        if (raw.length === 0)
            continue;
        const d = asRecord(raw);
        if (!d)
            continue;
        if (d.type === 'session') {
            if (typeof d.id === 'string')
                sessionId = d.id;
            if (typeof d.cwd === 'string')
                cwd = d.cwd;
            if (typeof d.createdAt === 'number')
                createdAt = d.createdAt;
        }
        else if (d.type === 'session/title' && typeof d.data === 'object') {
            const data = d.data;
            if (typeof data.title === 'string' && data.title.trim().length > 0)
                title = data.title.trim();
        }
        else if (DSH_CHAT_TYPES.has(String(d.type))) {
            const data = d.data;
            const text = dshEventText(data).trim();
            if (text.length === 0)
                continue;
            const role = String(d.type) === 'assistant/message' ? 'assistant' : 'user';
            const ts = typeof d.time === 'number' ? d.time : 0;
            if (ts > updatedAt)
                updatedAt = ts;
            if (createdAt === 0 || (ts !== 0 && ts < createdAt))
                createdAt = ts;
            if (role === 'user' && title === '')
                title = text.slice(0, 80);
            messages.push({ source: 'dsh', sessionId, seq: seq++, msgId: String(seq), role, content: cap(text), ts });
        }
    }
    return parsed('dsh', path, sessionId, { title: title || 'dsh session', cwd, createdAt, updatedAt, messages });
}
// ------------------------------------------------------------------ codex
/** Parse one Codex rollout JSONL. */
export async function parseCodex(path) {
    const messages = [];
    // The rollout filename is unique per artifact; payload.id is a logical
    // session id reused across rotation snapshots, so it must not key the index.
    const sessionId = basename(path).replace(/\.jsonl$/, '');
    let cwd = '';
    let createdAt = 0;
    let updatedAt = 0;
    let seq = 0;
    let firstUser = '';
    await eachLine(path, (raw) => {
        const d = asRecord(raw);
        if (!d)
            return;
        const ts = tsOf(d.timestamp);
        if (ts > updatedAt)
            updatedAt = ts;
        if (createdAt === 0 || (ts !== 0 && ts < createdAt))
            createdAt = ts;
        const payload = (d.payload ?? {});
        if (d.type === 'session_meta') {
            if (typeof payload.cwd === 'string')
                cwd = payload.cwd;
        }
        else if (d.type === 'event_msg') {
            const ptype = payload.type;
            if (ptype === 'user_message' || ptype === 'agent_message') {
                const text = typeof payload.message === 'string' ? payload.message.trim() : '';
                if (text.length === 0)
                    return;
                const role = ptype === 'user_message' ? 'user' : 'assistant';
                if (role === 'user' && firstUser === '')
                    firstUser = text.slice(0, 80);
                messages.push({ source: 'codex', sessionId, seq: seq++, msgId: String(seq), role, content: cap(text), ts });
            }
        }
    });
    return parsed('codex', path, sessionId, {
        title: firstUser || 'Codex session',
        cwd: cwd || 'unknown',
        createdAt,
        updatedAt,
        messages,
    });
}
// ------------------------------------------------------------------ claude
/** Decode a Claude Code project dir name back into a filesystem path. */
function decodeClaudeCwd(dirName) {
    // Claude Code encodes the project path as: '/' -> '-', '-' -> '--'.
    // Decode '--' to a placeholder first so literal '-' pairs survive.
    return dirName.replaceAll('--', '\u0000').replaceAll('-', '/').replaceAll('\u0000', '-');
}
/** Parse one Claude Code project transcript JSONL. */
export async function parseClaude(path) {
    const messages = [];
    let title = '';
    let createdAt = 0;
    let updatedAt = 0;
    let seq = 0;
    const sessionId = basename(path).replace(/\.jsonl$/, '');
    const cwd = decodeClaudeCwd(dirname(path).split(/[\\/]/).pop() ?? '');
    await eachLine(path, (raw) => {
        const d = asRecord(raw);
        if (!d)
            return;
        const ts = tsOf(d.timestamp);
        if (ts > updatedAt)
            updatedAt = ts;
        if (createdAt === 0 || (ts !== 0 && ts < createdAt))
            createdAt = ts;
        if (d.type === 'ai-title' && typeof d.title === 'string' && d.title.trim()) {
            title = d.title.trim();
        }
        else if (d.type === 'user' || d.type === 'assistant') {
            const message = d.message;
            const text = extractText(message?.content).trim();
            if (text.length === 0)
                return;
            messages.push({
                source: 'claude',
                sessionId,
                seq: seq++,
                msgId: typeof d.uuid === 'string' ? d.uuid : String(seq),
                role: d.type === 'user' ? 'user' : 'assistant',
                content: cap(text),
                ts,
            });
        }
    });
    return parsed('claude', path, sessionId, {
        title: title || 'Claude Code session',
        cwd: cwd || 'unknown',
        createdAt,
        updatedAt,
        messages,
    });
}
// ------------------------------------------------------------------ pi
/** Parse one pi session JSONL. */
export async function parsePi(path) {
    const messages = [];
    let sessionId = basename(path).replace(/\.jsonl$/, '');
    let cwd = '';
    let createdAt = 0;
    let updatedAt = 0;
    let seq = 0;
    let firstUser = '';
    await eachLine(path, (raw) => {
        const d = asRecord(raw);
        if (!d)
            return;
        const ts = tsOf(d.timestamp);
        if (ts > updatedAt)
            updatedAt = ts;
        if (createdAt === 0 || (ts !== 0 && ts < createdAt))
            createdAt = ts;
        if (d.type === 'session') {
            if (typeof d.id === 'string')
                sessionId = d.id;
            if (typeof d.cwd === 'string')
                cwd = d.cwd;
        }
        else if (d.type === 'message') {
            const m = (d.message ?? {});
            let role;
            if (m.role === 'user')
                role = 'user';
            else if (m.role === 'assistant')
                role = 'assistant';
            else if (m.role === 'toolResult' || m.role === 'tool')
                role = 'tool';
            else
                return;
            const text = extractText(m.content).trim();
            if (text.length === 0)
                return;
            if (role === 'user' && firstUser === '')
                firstUser = text.slice(0, 80);
            messages.push({
                source: 'pi',
                sessionId,
                seq: seq++,
                msgId: typeof d.id === 'string' ? d.id : String(seq),
                role,
                content: cap(text),
                ts,
            });
        }
    });
    return parsed('pi', path, sessionId, {
        title: firstUser || 'pi session',
        cwd: cwd || 'unknown',
        createdAt,
        updatedAt,
        messages,
    });
}
// ------------------------------------------------------------------ opencode
/**
 * Parse all sessions from one OpenCode SQLite database (read-only). Returns
 * one ParsedSession per `session` row; message text comes from `part` rows
 * with `data.type === 'text'`.
 */
export function parseOpencodeDb(path) {
    let db;
    try {
        db = new DatabaseSync(path, { readOnly: true });
    }
    catch {
        return [];
    }
    try {
        // Guard: only open when the expected tables exist.
        const hasTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('session', 'message', 'part')").all();
        if (hasTables.length < 3)
            return [];
        const sessionRows = db.prepare('SELECT id, directory, title, time_created, time_updated FROM session').all();
        const messagesBySession = new Map();
        const partStmt = db.prepare("SELECT message_id, session_id, data FROM part WHERE session_id = ? ORDER BY time_created, id");
        const messageStmt = db.prepare('SELECT id, session_id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id');
        const results = [];
        for (const row of sessionRows) {
            const messages = [];
            let seq = 0;
            const msgRows = messageStmt.all(row.id);
            for (const msg of msgRows) {
                let data = null;
                try {
                    data = JSON.parse(msg.data);
                }
                catch {
                    continue;
                }
                const role = data.role === 'user' ? 'user' : data.role === 'assistant' ? 'assistant' : 'tool';
                const ts = msg.time_created;
                // Aggregate text parts for this message.
                const partRows = partStmt.all(msg.session_id);
                const parts = [];
                for (const p of partRows) {
                    let pdata = null;
                    try {
                        pdata = JSON.parse(p.data);
                    }
                    catch {
                        continue;
                    }
                    if (pdata.type === 'text' && typeof pdata.text === 'string' && pdata.text.trim()) {
                        parts.push(pdata.text);
                    }
                }
                const text = parts.join('\n').trim();
                if (text.length === 0)
                    continue;
                messages.push({
                    source: 'opencode',
                    sessionId: row.id,
                    seq: seq++,
                    msgId: msg.id,
                    role,
                    content: cap(text),
                    ts,
                });
            }
            if (messages.length === 0 && !sessionRows.some(r => r.id === row.id && r.title)) {
                // keep only sessions with content or a title
            }
            results.push(parsed('opencode', path, row.id, {
                title: row.title && row.title.trim() ? row.title.trim() : (messages[0]?.content.slice(0, 80) ?? 'opencode session'),
                cwd: row.directory ?? 'unknown',
                createdAt: row.time_created ?? 0,
                updatedAt: row.time_updated ?? 0,
                messages,
            }));
        }
        return results;
    }
    finally {
        db.close();
    }
}
// ------------------------------------------------------------------ dispatch
/** Empty parsed shell for unreadable artifacts. */
function empty() {
    return { title: '', cwd: '', createdAt: 0, updatedAt: 0, messages: [] };
}
/**
 * Parse one discovered artifact into one or more ParsedSessions.
 * @param source - source family of the artifact.
 * @param path - absolute artifact path.
 * @returns parsed sessions; opencode yields one per session row.
 */
export async function parseFile(source, path) {
    switch (source) {
        case 'dsh': return [await parseDsh(path)];
        case 'codex': return [await parseCodex(path)];
        case 'claude': return [await parseClaude(path)];
        case 'pi': return [await parsePi(path)];
        case 'opencode': return parseOpencodeDb(path);
    }
}
/** Whether this source is a single-database source (indexed as one artifact). */
export function isDatabaseSource(source) {
    return source === 'opencode';
}
