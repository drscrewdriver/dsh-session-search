# dsh-session-search

DeepSeek Harness용 크로스 에이전트 세션 검색 플러그인——파생 데이터베이스를 생성하지 않고 로컬의 dsh, Codex, Claude Code, pi, OpenCode 과거 세션을 직접 스캔합니다.

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

> **호환성 참고:** `ja`와 `ko` 사전이 포함되어 있지만, 현재 공식 DSH 릴리스는 `LocaleRuntime`을 통해 `zh`와 `en`만 제공합니다. 순정 DSH에서 `ja` 또는 `ko`를 선택하면 `locale "<id>" is not registered` 오류가 발생합니다.
>
> **호스트 호환성:** 테스트된 DSH 호스트는 구간/caret 없이 rc 단위 정확 열거로 `engines.dsh`와 모든 `@deepseek-ai/dsh-*` peer에 명시됩니다: `0.1.0-rc.2 || 0.1.0-rc.3 || 0.1.0-rc.6 || 0.1.0-rc.7 || 0.1.0-rc.8 || 0.1.1-rc.1 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.5-rc.3 || 0.1.7-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1`.

## 기능

| 도구 | 설명 |
|---|---|
| `agent_session_search` | 현재 소스 아티팩트에 대한 대소문자 구분 없는 리터럴 검색: 일치 세션 + 가장 강력한 메시지 + 스니펫 + 메시지 윈도우; `sources`/`cwd`/`sort`/`limit` 필터 지원 |
| `agent_session_read` | 발견한 세션의 메타데이터와 메시지 윈도우를 읽음(`aroundSeq` 타겟팅) |

검색은 각 호출 시 현재 소스 아티팩트를 관찰하고 대소문자 구분 없는 리터럴 부분 문자열 매칭을 수행합니다.

## 지원되는 세션 소스

| 소스 | 기본 위치 | 읽기 모드 |
|---|---|---|
| dsh | `~/.dsh/sessions/**/session.jsonl.zstd` | 멀티프레임 zstd, 프레임별 디코딩 |
| codex | `~/.codex/sessions/**` + `archived_sessions/` | JSONL |
| claude | `~/.claude/projects/**` | JSONL |
| pi | `~/.pi/agent/sessions/**` | JSONL |
| opencode | `~/.local/share/opencode/opencode.db` | SQLite 읽기 전용 |

모든 소스는 **읽기 전용**: 세션 파일은 수정되지 않으며 데이터베이스, 인덱스, 영속 캐시를 생성하지 않습니다.

## 설치(marisa / dshx)

```sh
git clone https://github.com/Tieboyh/dsh-session-search.git
dshx install dsh-session-search ./dsh-session-search
```

또는 git URL에서 직접 설치. `~/.dsh/config.yaml`에 자동 마운트되며 다음 `dsh web`/TUI 시작 시 적용.

### 수동 마운트(dshx 없음)

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

## 구성

| 키 | 기본값 | 설명 |
|---|---|---|
| `sources` | 모두 활성화 | 소스별 부울 스위치 |
| `roots` | 소스별 기본값 | 소스별 루트 오버라이드 |
| `maxResults` | 10 | 한 번의 검색에 반환할 최대 세션 수 |
| `readWindow` | 10 | `agent_session_read` 기본 윈도우 |

## 구현 메모

- 파서는 방어적:过大·손상·읽기 불가 파일은 건너뛰고 전체 스캔을 실패시키지 않음.
- dsh 세션 로그는 **연결 프레임 zstd 스트림**: 프레임 경계를 구조 스캔으로 특정하고 프레임별로 디코딩.
- `sources`는 파일 발견 전에 적용. JSONL 소스에서는 `rg --fixed-strings --ignore-case`로 후보 파일 선정.
- 검색은 하나의 파싱된 세션씩 처리하고 바운드된 Top-K만 유지.
- 매칭은 리터럴이고 대소문자 비의존. 결과는 세션별로 그룹화.

## 개발

```sh
./scripts/build.sh   # dsh checkout의 tsc로 src → lib 컴파일
node tests/smoke.mjs # 스모크 테스트
```

## 라이선스

BSD-3-Clause
