# cyber-office-v2

`cyber-office` v2 runtime repo.

## 핵심 명령

```bash
./bin/co init
./bin/co doctor
./bin/co start
./bin/co ps
./bin/co attach
./bin/co stop
./bin/co status
```

테스트:

```bash
npm test
npm run smoke
npm run ci
```

- `npm test`: 하네스 회귀 테스트
- `npm run smoke`: fake Claude worker로 `ingress -> report -> job -> packet -> worker -> closeout` end-to-end smoke 실행
- `npm run ci`: runtime reset → init → doctor → 전체 테스트 → clean smoke 를 한 번에 실행

## 구독 모드 운영

Claude Code 구독 세션으로 운영할 때의 유일한 운영 경로는 `tmux`다.

초기 1회:

```bash
npm run legacy:cleanup
./bin/co init
./bin/co doctor
```

운영:

```bash
./bin/co start
./bin/co ps
./bin/co attach
./bin/co stop
```

- `co start`: `ceo`, `god`, `supervisor`를 하나의 `tmux` 세션에서 기동한다.
- `co start`는 멱등적이다. 이미 살아 있는 window는 유지하고, 죽은 window만 respawn 한다.
- `co start`는 legacy `launchd` service가 남아 있으면 실패한다. Discord ingress 중복 소비를 막기 위한 하드 하네스다.
- `co ps`: 각 service의 `running|dead|missing` 상태와 `legacyConflicts`를 같이 보여준다.
- `co attach`: `tmux` 세션에 붙어 실제 bot/stdout 을 본다.
- `co stop`: 세션 전체를 내린다.

실제 worker는 현재 로그인된 사용자 세션의 `claude` 인증을 그대로 사용한다. 즉, 일반 터미널에서 `claude -p "ping"` 이 성공하는 상태에서 `co start`를 실행해야 한다.

Discord token은 shared env 파일에서 읽는다.

```bash
$HOME/.config/cyber-office-v2/runtime.env
```

이 파일이 없으면 기존 `launchd.env`도 fallback으로 읽는다.

## 구조

- `role-registry.json`: 역할/티어/라우팅 규약
- `runtime/workers/*`: role별 `prompt.txt`, `settings.json`, `mcp.json`
- `runtime/*`: mission/job/event/artifact/ingress/packet/state 저장소
- `src/lib/*`: runtime 하네스 구현
- `src/discord-bot.js`: Discord ceo/god bot 엔트리
- `test/*.runtime.test.js`: 멱등성/closeout/worker/supervisor 회귀 테스트

## 런처 전환

- `co` → v2 (`/Users/designc/Documents/cyber-office-v2/bin/co`)
- `co-legacy` → v1 (`/Users/designc/Documents/cyber-office/bin/co`)

필요하면 `scripts/install-bin-links.sh`를 실행해 `~/bin` symlink를 맞춘다.

## CI

- GitHub Actions: [.github/workflows/ci.yml](/Users/designc/Documents/cyber-office-v2/.github/workflows/ci.yml)
- 트리거: `push` to `main`, `pull_request`
- 실행 내용: `npm run ci`

## Discord 운영

필수 환경변수:

```bash
export DISCORD_CEO_BOT_TOKEN=...
export DISCORD_GOD_BOT_TOKEN=...
export DISCORD_ADMIN_USER_IDS=801833538605285416
```

현재 동작:

- `ceo`: DM 또는 bot mention을 받아 thread를 만들고 `executeMissionFlow`를 수행
- `god`: `status`, `doctor`, `supervisor lease`, `supervisor tick`, `supervisor daemon` 명령 처리
- 실제 worker 실행은 `claude` 인증과 role별 MCP 환경에 의존한다.
- 수동 단일 프로세스 실행이 필요하면 `npm run bot:ceo`, `npm run bot:god`, `npm run supervisor:daemon`을 쓸 수 있지만, 상시 운영 기본값은 `co start`다.
