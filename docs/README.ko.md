<div align="center">

<h1 align="center">
  <img src="../assets/logo/open-flow-wordmark-auto.svg" alt="Open Flow" width="280" height="64" />
</h1>

**보고, 코딩하고, 실행하고, 직접 소유하는 워크플로를 만드세요.**

[English](../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

[![CI](https://github.com/oomol-lab/open-flow/actions/workflows/ci.yaml/badge.svg)](https://github.com/oomol-lab/open-flow/actions/workflows/ci.yaml)
[![npm](https://img.shields.io/npm/v/%40oomol-lab%2Fopen-flow/next?label=%40oomol-lab%2Fopen-flow)](https://www.npmjs.com/package/@oomol-lab/open-flow)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../LICENSE)
![Node.js 26](https://img.shields.io/badge/Node.js-26-339933)
![Bun 1.4](https://img.shields.io/badge/Bun-1.4-000000)

</div>

**AI 에이전트와 자동화를 만들고, 무엇이 실행될지 직접 확인하세요.**

Open Flow는 AI로 빠르게 구축하면서도 시각적인 워크플로로 구조를 명확하게 파악할 수 있는 오픈 소스 워크플로 플랫폼입니다. Codex, Claude Code 또는 다른 에이전트에게 Flow 생성을 요청하고, Workbench에서 열어 같은 워크플로를 함께 개선하세요.

하나의 캔버스에서 JavaScript, 앱 연동, AI, 조건 분기, 사람의 승인을 조합합니다. 입력을 확인하고 실행을 추적하며 어떤 버전을 실제로 운영할지 결정할 수 있습니다. OOMOL Hosted나 직접 관리하는 인프라에서 실행하세요.

[인터랙티브 데모 체험](https://openflow.run) · [OOMOL Hosted 사용](https://oomol.com) · [Docker로 직접 호스팅](#원하는-환경에서-실행)

![현재 Open Flow Workbench의 고객 온보딩 워크플로. 명시적인 고객 데이터, JavaScript, 승인, 하위 흐름을 표시](assets/readme-workbench.png)

> [!IMPORTANT]
> Open Flow는 베타 단계입니다. 제품과 버전 관리되는 계약은 계속 발전하고 있습니다.

## 에이전트가 만들고, 결정은 내가

필요한 작업을 설명하세요.

> “새 고객 지원 이메일을 읽고, 요청을 분류하고, 답장 초안을 작성한 뒤 보내기 전에 내 승인을 받아 줘.”

터미널 에이전트는 [`oo flow`](https://github.com/oomol-lab/oo-cli)를 통해 연동 기능을 찾고, 노드를 생성·편집하고, 초안을 검증·실행하고, 결과를 확인하며, 요청에 따라 게시할 수 있습니다. 변경 사항은 그래프를 검토하고 코드를 편집하는 바로 그 Workbench에 나타납니다. AI가 만든 별도 프로젝트를 변환하거나 동기화할 필요가 없습니다.

Server는 호환 클라이언트를 위한 [MCP 작성 및 실행 도구](server/mcp.md)도 제공합니다. 두 인터페이스 모두 선택한 배포 환경에 저장된 Flow, 리비전, 실행 기록을 다룹니다.

반복적인 연결 작업은 에이전트에게 맡기고, 중요한 결정은 눈에 보이는 곳에 두세요.

## 모든 단계를 확인할 수 있게

워크플로를 만들 때 나눈 대화가 없어져도 워크플로 자체는 이해할 수 있어야 합니다.

- **정확한 작업은 JavaScript로.** 이름과 타입이 명확한 입력·출력을 갖춘 Code Task에서 데이터를 변환하고 메시지를 구성하거나 사용자 정의 로직을 작성하세요.
- **명시적인 입력 출처.** 속성 패널에서 값이 어디에서 오는지 확인합니다. 제어 연결은 다음에 실행할 작업을, 입력 매핑은 각 단계가 받을 데이터를 결정합니다.
- **분기와 재사용 가능한 하위 흐름.** 조건에 따라 작업을 나누고 반복되는 로직에 명확한 인터페이스를 정의하세요.
- **작업 옆에 남기는 설명.** 캔버스에 결정 이유를 직접 적어 다음 사람이 의도를 이해할 수 있게 하세요.

![현재 Code Task 속성 패널의 JavaScript, 고객 입력 출처, 타입이 지정된 메시지 출력](assets/readme-code.png)

## AI에게 명확한 작업과 경계 부여

분류, 추출, 요약에는 LLM Task를 사용하고 여러 도구 호출이 필요한 작업에는 Agent Task를 사용하세요. 예측 가능한 동작이 필요한 곳에는 일반 코드, 조건, 승인을 함께 배치할 수 있습니다.

Agent Task에는 설정된 모델, 명시적으로 선언된 도구, 실행 제한이 있습니다. 도구 설정은 모델이 사용할 수 있는 작업, 계정, 승인 정책을 정합니다. 도구 호출에 사람의 승인을 요구하거나 워크플로에 Approval 노드를 배치해 다음 단계가 승인 후 진행되도록 할 수 있습니다.

Approval과 Wait 노드는 대기 상태를 영구 저장합니다. 결정이 내려지면 해당 실행에서 이미 완료된 단계를 반복하지 않고 이어서 진행할 수 있습니다.

## 실행을 확인하고 운영 버전을 선택

선택한 트리거에서 초안을 테스트하고 Workbench에서 실행을 추적하세요. 마지막 메시지만 보고 과정을 추측하는 대신 노드 결과, 로그, 오류, 승인 대기 항목을 살펴볼 수 있습니다. 실행 기록은 각 실행과 그 실행에 사용된 리비전의 관계를 유지합니다.

![Open Flow Workbench에서 사람의 승인을 기다리는 고객 온보딩 테스트 실행](assets/readme-approval.png)

게시하면 Live 자동화에 사용할 버전 스냅샷이 생성됩니다. 게시된 버전이 실행되는 동안 초안을 계속 편집하고, 이전 Publication을 검토하고, 필요할 때 롤백할 수 있습니다.

수동으로 시작하거나 일정, 웹훅, 지원되는 서비스 이벤트와 폴링 소스로 작업을 시작하세요. 같은 배포 환경이 워크플로, Live 버전, 실행 상태를 관리합니다.

## 자격 증명을 그래프에 넣지 않고 앱 연결

Open Flow는 [OpenConnector](https://github.com/oomol-lab/open-connector) 같은 Connector 런타임을 통해 Gmail, Slack, GitHub, Notion 등의 작업을 검색하고 실행합니다. 계정 자격 증명은 Connector가 보관하고, 워크플로는 Connection 식별자를 참조합니다.

OOMOL Hosted는 지원되는 연동에 관리형 OAuth 앱을 제공합니다. 직접 호스팅할 때는 Connector 배포 환경을 선택하고 필요한 서비스 설정과 계정 권한 부여를 관리합니다. 워크플로 로직과 계정 접근 권한은 각각 독립적으로 다룹니다.

계정 권한 부여부터 첫 Flow 생성까지의 전체 설정은 [OpenConnector 및 oo CLI와 함께 Open Flow 사용](server/self-hosted-stack/README.ko.md)을 참고하세요.

## 원하는 환경에서 실행

| 방식             | 직접 관리하는 항목                                      | 시작하기                                  |
| ---------------- | ------------------------------------------------------- | ----------------------------------------- |
| **OOMOL Hosted** | 워크플로와 연결된 계정. 배포 환경은 OOMOL이 운영합니다. | [OOMOL 열기](https://oomol.com)           |
| **Docker**       | 배포, 스토리지, 백업, 업그레이드, 연동.                 | 아래 명령어                               |
| **Fly.io**       | Fly 인프라의 앱, 영구 볼륨, 비밀값, 백업, 업그레이드.   | [배포 가이드](server/fly-io/README.ko.md) |

로컬에서 직접 호스팅하려면 Docker와 OpenSSL을 설치하고 실행하세요.

```bash
git clone https://github.com/oomol-lab/open-flow.git
cd open-flow

export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"
docker build --file apps/server/Dockerfile --tag open-flow-server:dev .
docker run --rm \
  --publish 3000:3000 \
  --env OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  --volume open-flow-data:/data/open-flow \
  open-flow-server:dev
```

[http://127.0.0.1:3000](http://127.0.0.1:3000)을 열고 `OPEN_FLOW_TOKEN`으로 로그인하세요. Flow와 실행 기록은 Docker 볼륨에 저장됩니다. 같은 운영자 토큰을 CLI와 API 인증에도 사용합니다.

미리 빌드된 이미지를 사용하려면 [GHCR 이미지 가이드](server/docker-ghcr/README.ko.md)를 따르고, 베타 기간에는 명시적인 릴리스 태그를 선택하세요. `latest` 태그는 안정 버전용입니다.

Connector 작업과 LLM Task는 해당 서비스를 설정해야 사용할 수 있습니다. Server는 다른 제공자로 몰래 전환하지 않습니다. 외부에 공개하기 전에 [배포 가이드](server/container-delivery.md)와 [보안 강화 체크리스트](../SECURITY.md#hardening-your-deployment)를 따르세요.

## Open Flow를 기반으로 개발

Open Flow는 Apache-2.0 라이선스로 제공됩니다. 저장소에는 워크플로 계약과 런타임, Workbench, CLI 명령 패키지, 직접 호스팅할 수 있는 Server가 포함됩니다. 버전 관리되는 Control API 덕분에 클라이언트는 배포 환경의 스토리지 및 실행 구현에 종속되지 않습니다.

`.bun-version`과 `.node-version`에 고정된 Bun 및 Node.js 버전을 사용하세요.

```bash
bun install --frozen-lockfile
bun run dev
```

개발용 Workbench는 [http://localhost:5174](http://localhost:5174)에서 열 수 있습니다. 처음 실행하면 `apps/server/.open-flow-dev/operator-token`에 운영자 토큰이 생성됩니다. 설정, 검사, 컴포넌트 Lab은 [CONTRIBUTING.md](../CONTRIBUTING.md)를 참고하세요.

| 더 알아보기                | 참고 자료                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 제품 모델과 런타임 경계    | [아키텍처](architecture.md)                                                                                               |
| 자체 클라이언트 연동       | [Control API](control/contracts/control-api.md) · [MCP](server/mcp.md)                                                    |
| 배포와 운영                | [Server](server/container-delivery.md) · [Docker](server/docker-ghcr/README.ko.md) · [Fly.io](server/fly-io/README.ko.md) |
| 앱과 AI 코딩 에이전트 연결 | [OpenConnector + oo CLI](server/self-hosted-stack/README.ko.md)                                                           |
| 전체 문서 탐색             | [문서 색인](README.md)                                                                                                    |

## 관련 프로젝트

- [OpenConnector](https://github.com/oomol-lab/open-connector): Connector 기반 노드 뒤에서 Provider 카탈로그, 자격
  증명, Action 실행을 제공하는 오픈소스 Connector 게이트웨이
- [oo CLI](https://github.com/oomol-lab/oo-cli): 이 저장소에서 빌드된 `oo flow` 명령을 호스팅하는 로컬 Agent 툴킷

## 기여하기

Issue와 Pull Request를 환영합니다. 개발 환경 설정, 저장소 규칙, Pull Request를 열기 전에 실행할 검사는
[CONTRIBUTING.md](../CONTRIBUTING.md)를 참고하세요. 이 프로젝트 참여는 [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)를
따릅니다.

## 보안

취약점은 공개 Issue 대신
[GitHub 비공개 취약점 보고](https://github.com/oomol-lab/open-flow/security/advisories/new)를 통해 비공개로 보고해
주세요. [SECURITY.md](../SECURITY.md)에 지원되는 버전, 공개 절차, 보고 범위, 자체 호스팅 배포 강화 방법이 설명되어
있습니다.

## 라이선스

[Apache-2.0](../LICENSE). 번들된 자산의 서드파티 고지는 [NOTICE](../NOTICE)에 정리되어 있습니다.

## 기여자

Open Flow를 함께 만들어 주신 모든 기여자께 감사드립니다.
[기여 안내](../CONTRIBUTING.md)를 확인하고 함께해 주세요.

[![Open Flow 기여자](https://contrib.rocks/image?repo=oomol-lab/open-flow)](https://github.com/oomol-lab/open-flow/graphs/contributors)

## Star 히스토리

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/star-history/star-history-dark.svg">
  <img alt="Star history" src="../assets/star-history/star-history-light.svg">
</picture>
