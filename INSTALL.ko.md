# 설치 안내

- [한국어 설치 안내](./INSTALL.ko.md)
- [English installation guide](./INSTALL.md)
- [中文安装指南](./INSTALL.zh.md)
- [日本語インストールガイド](./INSTALL.ja.md)
- [한국어 README](./README.ko.md)
- [English README](./README.md)
- [中文 README](./README.zh-CN.md)
- [日本語 README](./README.ja.md)
- [Changelog](./CHANGELOG.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)

## 설치(marisa / dshx)

```sh
git clone https://github.com/Tieboyh/dsh-session-search.git
dshx install dsh-session-search ./dsh-session-search
```

또는 git URL에서 직접 설치. `~/.dsh/config.yaml`에 자동 마운트되며 다음 `dsh web`/TUI 시작 시 적용.

## 수동 마운트(dshx 없음)

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

## 제거

`~/.dsh/config.yaml`에서 항목을 제거하고 `dsh web`을 재시작.
