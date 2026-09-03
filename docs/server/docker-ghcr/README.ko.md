# Docker 이미지 (GHCR)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow는 GitHub Packages 컨테이너 레지스트리 (GHCR)에 미리 빌드된 Server 이미지를 배포합니다. 저장소를 clone하거나 직접 빌드하지 않고도
실행할 수 있습니다. 이미지 이름은 다음과 같습니다:

```text
ghcr.io/oomol-lab/open-flow
```

이미지 내용은 [컨테이너 배포 참조](../container-delivery.md)에 설명된 것과 같습니다: Workbench, Control API, Run runtime, Trigger runtime,
SQLite migration을 포함한 하나의 Server 프로세스입니다. 구성, 헬스 체크, 영속화, 백업은 그 문서에 있으며 여기서는 반복하지 않습니다.

## Tag 선택

| Tag             | 가리키는 대상                            | 사용 시점                                                 |
| --------------- | ---------------------------------------- | --------------------------------------------------------- |
| `latest`        | 최신 안정 Release                        | 현재 안정 버전 Server가 필요할 때                         |
| `<release-tag>` | `v0.1.0-beta.1` 같은 특정 Release (불변) | 프로덕션에 배포하며 고정되고 재현 가능한 빌드가 필요할 때 |
| `tip`           | `main`의 최신 커밋                       | 아직 릴리스되지 않은 변경을 시험하고 싶을 때              |
| `<short-sha>`   | `main`의 특정 커밋 (불변)                | 특정 프리릴리스 빌드에 고정하고 싶을 때                   |

모든 GitHub Release는 자신의 tag를 게시합니다. 안정 Release는 `latest`도 이동시키지만 pre-release는 그렇지 않으므로 `latest`는 beta를
가리키지 않습니다. `main`에 push할 때마다 `tip`과 짧은 커밋 해시가 게시됩니다. 같은 이름의 tag는 더 새로운 빌드로 교체되므로 `latest`와
`tip`은 이동하고, Release tag와 커밋 해시는 고정됩니다.

Open Flow는 beta 단계입니다. `latest`는 첫 안정 Release와 함께 생기므로 그 전에는 `tip`이나 `v0.1.0-beta.1` 같은 beta Release tag를 사용하세요. 프로덕션에서는 `latest` 대신 Release tag에 고정하세요.

## Pull

이미지는 공개되어 있어 로그인이 필요 없습니다:

```bash
docker pull ghcr.io/oomol-lab/open-flow:tip
```

`unauthorized` 또는 `denied` 오류가 나면 `read:packages` scope가 있는 GitHub token으로 로그인하세요:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

이미지는 멀티 아키텍처 (`linux/amd64` + `linux/arm64`)입니다. 각 아키텍처는 네이티브로 빌드되므로 Apple Silicon과 AWS Graviton을 포함해
Docker가 `--platform` 플래그 없이 머신에 맞는 버전을 pull합니다.

## 실행

이미지는 `3000` 포트에서 수신하고 `0.0.0.0`에 바인딩하며 SQLite를 `/data/open-flow`에 저장합니다. 재시작 후에도 데이터가 남도록 그 경로에
volume을 마운트하세요.

Server는 환경 변수에서 operator token을 받을 수 있습니다. 32바이트 이상의 token을 생성해 안전한 곳에 보관하세요. Workbench 로그인에 쓰이며
Control API의 Bearer token으로도 동작합니다:

```bash
export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"

docker run -d \
  --name open-flow \
  --stop-timeout 45 \
  -p 3000:3000 \
  -v open-flow-data:/data/open-flow \
  -e OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  ghcr.io/oomol-lab/open-flow:tip
```

[http://127.0.0.1:3000](http://127.0.0.1:3000)을 열고 그 token으로 로그인합니다. `OPEN_FLOW_TOKEN`을 생략하면 첫 시작 시 로그에 일회성
setup code가 출력되고, Workbench는 token을 설정하기 전에 그 code를 요구합니다. 클레임 절차는 [시작](../container-delivery.md#3-启动)을 참고하세요.

Connector나 LLM 서비스를 연결하려면 [구성 표](../container-delivery.md#4-配置)의 변수를 추가하세요.
[셀프 호스팅 스택 가이드](../self-hosted-stack/README.ko.md)는 OpenConnector와 oo CLI로 Open Flow를 실행하는 과정을 안내합니다.

### Docker Compose

저장소 루트에는 게시된 이미지를 같은 포트와 volume으로 실행하는 `docker-compose.yml`이 있습니다. 거기에 나열된 변수는 셸에서 읽히며 설정되지
않은 것은 생략되므로 이미지 기본값이 적용됩니다:

```bash
export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"
docker compose up -d
docker compose logs -f open-flow
```

특정 tag를 실행하려면 아래 업그레이드 명령을 포함한 모든 compose 명령 전에 셸에서 `OPEN_FLOW_IMAGE_TAG`를 export하세요. 그렇지 않으면 고정한 Release가 `tip`으로 되돌아갑니다. 예: `export OPEN_FLOW_IMAGE_TAG=v0.1.0-beta.1`.

### 소스에서 빌드

pull하지 않고 직접 이미지를 빌드하려면 build overlay를 추가하세요. `apps/server/Dockerfile`을 빌드하고 `docker-compose.yml`과 같은 이름으로
tag를 붙입니다:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

## 업그레이드

새 tag를 pull한 뒤 같은 volume으로 컨테이너를 다시 만드세요. Server는 시작 시 보류 중인 SQLite migration을 실행하고, 중지 시 30초 기한 안에
진행 중인 Run을 마무리합니다:

```bash
docker compose pull
docker compose up -d
```

데이터 volume에 쓸 수 있는 Server 컨테이너는 한 번에 하나뿐입니다. 이전 컨테이너가 같은 volume을 사용하는 동안 새 컨테이너를 시작하지 마세요.
프로덕션을 업그레이드하기 전에 [quiesced backup](../container-delivery.md#6-持久化与恢复)을 받으세요.
