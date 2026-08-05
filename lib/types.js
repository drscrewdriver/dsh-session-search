/**
 * Shared types for the cross-agent session search plugin.
 *
 * Every source (dsh, codex, claude, pi, opencode) is normalized into the same
 * two records: one per session file, one per extractable message. The index
 * stores exactly these shapes; tools render them back to the model.
 * @module @dsh-external/dsh-session-search/types
 */
export {};
