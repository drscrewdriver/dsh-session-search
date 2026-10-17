# 変更履歴

`dsh-session-search` の主な変更を記録します。

- [English changelog](./CHANGELOG.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)

## 0.1.1 — 2026-10-17

### 変更

- マニフェストのみのリリース：プレースホルダーだった `@dsh-external` npm スコープを廃止し、姉妹プラグインと同じ `dsh-session-search` として公開。
- `engines.dsh` とすべての `@deepseek-ai/dsh-*` peer を区間/caret から精確な rc 列挙（16 項目、`0.2.1-rc.1` まで）に書き換え、二重マニフェスト列挙規約に適合。
- `publishConfig.registry` を `https://registry.npmjs.org` に固定；README にテスト済みホスト列挙を明記。

## 0.1.0 — 2026-08-18

### 追加

- 初回リリース：インデックス不要のクロスエージェント会話検索。dsh、Codex、Claude Code、pi、OpenCode ソースをサポート。
- `agent_session_search` ツール：ソース/cwd/ソート/リミットフィルタ付きの大文字小文字非依存リテラル検索。
- `agent_session_read` ツール：`aroundSeq` ターゲティングによるセッションメタデータとメッセージウィンドウの読み取り。
- 防御的パーサー：過大・破損・読み取り不可ファイルはスキップ。
- dsh 連結フレーム zstd ストリームサポート。
- システムプロンプト注入によるモデルガイダンス。
