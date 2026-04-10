# cyber-office-v2

`cyber-office` v2 runtime repo.

## 핵심 명령

```bash
./bin/co init
./bin/co doctor
./bin/co status
./bin/co smoke
./bin/co supervisor lease "$(printf '%s' $$)"
./bin/co supervisor tick "$(printf '%s' $$)"
```

테스트:

```bash
npm test
npm run smoke
npm run ci
```

- `npm test`: 하네스 회귀 테스트 16개
- `npm run smoke`: fake Claude worker로 `ingress -> report -> job -> packet -> worker -> closeout` end-to-end smoke 실행
- `npm run ci`: runtime reset → init → doctor → 전체 테스트 → clean smoke 를 한 번에 실행
- 실제 Claude로 돌리려면:

```bash
./bin/co smoke
```

이 경우 `claude` 인증과 각 role의 MCP 환경이 준비돼 있어야 한다.

## 구조

- `role-registry.json`: 역할/티어/라우팅 규약
- `runtime/workers/*`: role별 `prompt.txt`, `settings.json`, `mcp.json`
- `runtime/*`: mission/job/event/artifact/ingress/packet/state 저장소
- `src/lib/*`: runtime 하네스 구현
- `test/*.runtime.test.js`: 멱등성/closeout/worker/supervisor 회귀 테스트

## 런처 전환

- `co` → v2 (`/Users/designc/Documents/cyber-office-v2/bin/co`)
- `co-legacy` → v1 (`/Users/designc/Documents/cyber-office/bin/co`)

필요하면 `scripts/install-bin-links.sh`를 실행해 `~/bin` symlink를 맞춘다.

## CI

- GitHub Actions: [.github/workflows/ci.yml](/Users/designc/Documents/cyber-office-v2/.github/workflows/ci.yml)
- 트리거: `push` to `main`, `pull_request`
- 실행 내용: `npm run ci`
