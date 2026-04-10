# cyber-office-v2

`cyber-office` v2 runtime repo.

## 핵심 명령

```bash
./bin/co init
./bin/co doctor
./bin/co status
./bin/co smoke
./bin/co dispatch 12345 "로그인 이슈를 조사해줘"
./bin/co supervisor lease "$(printf '%s' $$)"
./bin/co supervisor tick "$(printf '%s' $$)"
```

테스트:

```bash
npm test
npm run smoke
npm run ci
```

- `npm test`: 하네스 회귀 테스트 19개
- `npm run smoke`: fake Claude worker로 `ingress -> report -> job -> packet -> worker -> closeout` end-to-end smoke 실행
- `npm run ci`: runtime reset → init → doctor → 전체 테스트 → clean smoke 를 한 번에 실행
- `npm run bot:ceo`: Discord CEO bot 실행
- `npm run bot:god`: Discord GOD bot 실행
- `npm run supervisor:daemon`: supervisor daemon 실행
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

실행:

```bash
npm run bot:ceo
npm run bot:god
npm run supervisor:daemon
```

현재 동작:

- `ceo`: DM 또는 bot mention을 받아 thread를 만들고 `executeMissionFlow`를 수행
- `god`: `status`, `doctor`, `supervisor lease`, `supervisor tick`, `supervisor daemon` 명령 처리
- 실제 worker 실행은 `claude` 인증과 role별 MCP 환경에 의존

## launchd

macOS에서 상시 실행:

```bash
npm run launchd:install
npm run launchd:status
```

제거:

```bash
npm run launchd:uninstall
```

설치 시 아래 파일이 생성된다.

- env: `~/.config/cyber-office-v2/launchd.env`
- agents: `~/Library/LaunchAgents/com.znehraks.cyber-office-v2.{ceo,god,supervisor}.plist`
- logs: `~/Library/Logs/cyber-office-v2/*.log`
- service snapshot: `~/.local/share/cyber-office-v2/current`

`launchd.env`에 실제 Discord 토큰을 넣은 뒤 `npm run launchd:install`을 다시 실행하면 된다.
토큰이 비어 있으면 `supervisor`만 즉시 bootstrap되고, `ceo`/`god`는 plist만 설치된 채 대기한다. 이 상태에서 토큰을 채운 뒤 `npm run launchd:install`을 다시 실행하면 된다.
repo가 `~/Documents` 아래에 있어도 launchd는 직접 repo를 읽지 않고 service snapshot에서 실행된다. 코드를 업데이트했으면 `npm run launchd:install`로 snapshot을 다시 동기화해야 한다.
