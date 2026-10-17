# 변경 기록

`dsh-session-search`의 주요 변경 사항을 기록합니다.

- [English changelog](./CHANGELOG.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)

## 0.1.1 — 2026-10-17

### 변경

- 매니페스트 전용 릴리스: 자리표시자였던 `@dsh-external` npm 스코프를 폐기하고 자매 플러그인과 동일한 `dsh-session-search`로 공개.
- `engines.dsh`와 모든 `@deepseek-ai/dsh-*` peer을 구간/caret에서 정확한 rc 열거(16항, `0.2.1-rc.1`까지)로 교체하여 이중 매니페스트 열거 규정을 충족.
- `publishConfig.registry`를 `https://registry.npmjs.org`로 고정; README에 테스트된 호스트 열거 명시.

## 0.1.0 — 2026-08-18

### 추가

- 최초 릴리스: 인덱스 없는 크로스 에이전트 세션 검색. dsh, Codex, Claude Code, pi, OpenCode 소스 지원.
- `agent_session_search` 도구: 소스/cwd/정렬/제한 필터가 있는 대소문자 구분 없는 리터럴 검색.
- `agent_session_read` 도구: `aroundSeq` 타겟팅을 통한 세션 메타데이터와 메시지 윈도우 읽기.
- 방어적 파서:过大·손상·읽기 불가 파일은 건너뛰기.
- dsh 연결 프레임 zstd 스트림 지원.
- 시스템 프롬프트 주입을 통한 모델 가이던스.
