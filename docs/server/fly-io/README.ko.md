# Fly.io 배포

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow Server는 Fly.io에서 Node Docker 런타임으로 실행할 수 있습니다. 이 배포는 저장소의
`apps/server/Dockerfile`, 저장소 루트 `fly.toml`의 Fly app 설정, 그리고 `/data/open-flow`에
마운트되는 Fly volume을 사용합니다. Fly는 TLS 종료, 원격 Docker 빌드, 헬스 체크, 롤링 배포,
선택적인 custom domain을 제공합니다.

배포 경계는 [컨테이너 배포 참조](../container-delivery.md)와 동일합니다. Server machine 하나와
SQLite writer 하나입니다. machine을 두 대 이상 실행하지 마세요.

## 사전 요구 사항

- Fly.io 계정.
- `flyctl`이 설치되어 있고 `fly auth login`으로 인증되어 있어야 합니다.
- 로컬에서 Docker를 사용할 수 있거나 Fly remote builder를 사용할 수 있어야 합니다.
  `apps/server/Dockerfile`은 BuildKit 문법을 사용하며, remote builder는 이를 지원합니다.

## App 만들기

아직 배포하지 않고 Fly app만 만듭니다.

```bash
fly apps create my-open-flow
```

Fly app 이름은 전역적으로 고유합니다. 다른 이름을 선택했다면 배포 전에 `fly.toml`의 `app` 필드를
수정하세요.

```toml
app = "my-open-flow"
```

## 영구 스토리지 만들기

이미지는 SQLite를 `/data/open-flow`에 저장합니다. `fly.toml`과 같은 source 이름으로 Fly volume을
만듭니다.

```bash
fly volumes create open_flow_data \
  --region iad \
  --size 1 \
  --app my-open-flow
```

Run 이력과 RunEvent는 시간이 지날수록 늘어납니다. 많은 Run이 예상되면 `--size`를 늘리거나, 나중에
`fly volumes extend`로 volume을 확장하세요.

## Secret 설정

operator token은 최소 32 UTF-8 바이트를 포함해야 합니다. `fly.toml`에 커밋하는 대신 Fly secret으로
저장하세요.

```bash
OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"

fly secrets set \
  OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  --app my-open-flow
```

`OPEN_FLOW_TOKEN`은 비밀번호 관리자에 보관하세요. 같은 값으로 Workbench에 로그인하며, Control API의
Bearer token으로도 사용할 수 있습니다.

`fly.toml`은 이미 `OPEN_FLOW_SESSION_COOKIE_SECURE`를 `true`로 설정합니다. `force_https`가 일반 HTTP
요청을 리디렉션하므로 브라우저는 TLS를 통해서만 Server에 접근합니다.

Connector가 필요하면 Connector secret을 설정합니다.

```bash
fly secrets set \
  OPEN_FLOW_CONNECTOR_ORIGIN="https://connector.example.com" \
  OPEN_FLOW_CONNECTOR_TOKEN="replace-with-a-scoped-runtime-token" \
  OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN="https://connector.example.com" \
  --app my-open-flow
```

OpenConnector가 같은 Fly organization에서 실행 중이면 runtime origin은
`http://my-open-connector.internal:3000`처럼 Fly 프라이빗 네트워크를 사용할 수 있습니다. console
origin은 여전히 사용자의 브라우저가 열 수 있는 공개 HTTPS origin이어야 합니다.

Provider Integration이 필요하면 콜백 origin과 key를 설정합니다.

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://my-open-flow.fly.dev" \
  OPEN_FLOW_INTEGRATION_CALLBACK_KEY="$(openssl rand -hex 32)" \
  --app my-open-flow
```

`fly secrets set`은 machine을 다시 배포합니다. 전체 환경 변수 목록과 각 origin의 제약은
[컨테이너 배포 참조](../container-delivery.md#4-配置)를 참고하세요.

## 배포

저장소 루트에서 배포합니다.

```bash
fly deploy --config fly.toml --remote-only --ha=false
```

`--ha=false`는 Fly가 새 app에 두 번째 machine을 만들지 않도록 합니다. Server는 SQLite writer를 하나만
허용하고 각 machine은 자체 volume을 마운트하므로, machine이 두 대이면 서로 무관한 상태 복사본 두 개를
갖게 됩니다. 이후 모든 배포에서도 machine 수를 하나로 유지하고 `fly scale count`로 늘리지 마세요.

Fly 설정은 다음을 사용합니다.

- 이미지 빌드에 `apps/server/Dockerfile`을 사용하며, 저장소 루트가 빌드 컨텍스트입니다.
- 이미지 기본값인 `internal_port = 3000`.
- HTTP 헬스 체크로 `GET /readyz`. Server가 시작 중이거나, 백그라운드 처리가 중지되었거나, 구성된
  Connector에 연결할 수 없으면 503을 반환합니다. 그러면 Fly는 해당 machine으로의 트래픽 라우팅을
  중단하고 배포를 실패 처리합니다. liveness 체크만 원한다면 경로를 `/healthz`로 바꾸세요.
- `kill_signal = "SIGTERM"`과 `kill_timeout = "45s"`. Server는 Run을 드레인하고 SQLite를 닫기 위해
  최대 30초를 기다리므로 유예 기간은 30초보다 길어야 합니다.
- `auto_stop_machines = "off"`와 `min_machines_running = 1`. Cron과 Poll Trigger는 machine이 실행
  중일 때만 발생합니다.

## 런타임 확인

```bash
curl https://my-open-flow.fly.dev/healthz
curl https://my-open-flow.fly.dev/readyz
```

예상 응답은 `{"status":"ok"}`와 `{"status":"ready"}`입니다. `https://my-open-flow.fly.dev`를 열고
`OPEN_FLOW_TOKEN`으로 Workbench에 로그인합니다.

배포나 시작 문제를 진단할 때는 로그를 확인합니다.

```bash
fly logs --app my-open-flow
```

## Custom Domain

Fly에 도메인을 등록합니다.

```bash
fly certs add flow.example.com --app my-open-flow
```

Fly가 생성해야 할 DNS 레코드를 출력합니다. DNS가 준비되면 인증서 상태를 확인합니다.

```bash
fly certs check flow.example.com --app my-open-flow
```

Integration 콜백이 구성되어 있다면 `OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN`이 새 도메인을 가리키도록
설정합니다.

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://flow.example.com" \
  --app my-open-flow
```

## 업데이트

```bash
git pull
fly deploy --config fly.toml --remote-only
```

volume은 `open-flow.sqlite`와 그 WAL, SHM 파일을 유지합니다. SQLite 마이그레이션은 Server가 시작될 때
순서대로 실행되므로 추가 단계가 필요 없습니다.

## 백업

Fly는 volume 스냅샷을 자동으로 생성하지만, Server는 정지 상태에서의 백업만 보장합니다. 일관된 백업을
위해 스냅샷을 만들기 전에 machine을 중지하세요.

```bash
fly machine stop <machine-id> --app my-open-flow
fly volumes snapshots create <volume-id> --app my-open-flow
fly volumes snapshots list <volume-id> --app my-open-flow
fly machine start <machine-id> --app my-open-flow
```

snapshot은 비동기로 생성됩니다. `fly volumes snapshots list`에서 새 snapshot이 `created`로 표시될 때까지 machine을 중지 상태로
유지한 뒤 machine을 시작하세요.

id는 `fly machine list`와 `fly volumes list`로 찾을 수 있습니다.

## 스케일링과 유휴 Machine

- machine 수는 하나로 유지하세요. 더 많은 용량이 필요하면 `fly.toml`의 `[[vm]]` 아래 `size`와
  `memory`를 변경하고 다시 배포하세요.
- 기본값은 `memory = "1gb"`입니다. 각 Run의 Isolated VM은 기본적으로 128 MB로 제한되고,
  `OPEN_FLOW_MAX_CONCURRENT_RUNS`의 기본값은 4이며, Node 프로세스에도 자체 메모리가 필요합니다.
  메모리는 동시성 제한과 함께 올리세요.
- 수동 Run과 Webhook만 사용하고 콜드 스타트를 감수할 수 있다면 `auto_stop_machines = "suspend"`와
  `min_machines_running = 0`으로 설정하세요. machine이 일시 중지된 동안에는 Cron과 Poll Trigger가
  발생하지 않으며, 첫 Webhook 요청은 machine이 깨어날 때까지 기다립니다.
