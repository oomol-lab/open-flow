# Docker 镜像 (GHCR)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow 在 GitHub Packages 容器仓库 (GHCR) 发布预构建的 Server 镜像，无需克隆仓库或自行构建即可运行。镜像名为:

```text
ghcr.io/oomol-lab/open-flow
```

镜像内容与[容器交付参考](../container-delivery.md)描述的一致: 一个 Server 进程，包含 Workbench、Control API、Run runtime、Trigger runtime 和
SQLite migration。配置、健康检查、持久化和备份在该文档中说明，这里不再重复。

## 选择 Tag

| Tag             | 指向                                            | 适用场景                         |
| --------------- | ----------------------------------------------- | -------------------------------- |
| `latest`        | 最新的稳定 Release                              | 需要当前稳定版 Server            |
| `<release-tag>` | 某个具体 Release，例如 `v0.1.0-beta.1` (不可变) | 生产部署，需要固定且可复现的构建 |
| `tip`           | `main` 分支最新提交                             | 想试用尚未发布的改动             |
| `<short-sha>`   | `main` 分支某个具体提交 (不可变)                | 需要固定到某个精确的预发布构建   |

每个 GitHub Release 都会发布其 tag。稳定 Release 会同时移动 `latest`；pre-release 不会，因此 `latest` 不会指向 beta。每次推送到 `main`
都会发布 `tip` 和短提交 hash。同名 tag 会被更新的构建覆盖，所以 `latest` 和 `tip` 会移动，而 Release tag 和提交 hash 固定不变。

Open Flow 目前处于 beta 阶段: `latest` 会随首个稳定 Release 出现，在此之前请使用 `tip` 或 beta Release tag，例如 `v0.1.0-beta.1`。生产环境请固定到 Release tag，不要使用 `latest`。

## 拉取

镜像是公开的，不需要登录:

```bash
docker pull ghcr.io/oomol-lab/open-flow:tip
```

如果遇到 `unauthorized` 或 `denied` 错误，用带 `read:packages` scope 的 GitHub token 登录:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

镜像是多架构的 (`linux/amd64` + `linux/arm64`)。每个架构都在原生机器上构建，Docker 会自动拉取与本机匹配的版本，包括 Apple Silicon 和
AWS Graviton，不需要 `--platform` 参数。

## 运行

镜像监听 `3000` 端口，绑定 `0.0.0.0`，SQLite 保存在 `/data/open-flow`。请在该路径挂载 volume，以便数据在重启后保留。

Server 可以从环境变量读取 operator token。生成一个至少 32 字节的 token 并妥善保存。它用于登录 Workbench，也可作为 Control API 的 Bearer token:

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

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)，用该 token 登录。如果省略 `OPEN_FLOW_TOKEN`，首次启动会在日志中输出一次性 setup code，
Workbench 会先要求输入该 code 再设置 token；认领流程见[启动](../container-delivery.md#3-启动)。

要接入 Connector 或 LLM 服务，按[配置表](../container-delivery.md#4-配置)添加对应变量。
[自托管组合指南](../self-hosted-stack/README.zh-CN.md)演示了如何用 OpenConnector 和 oo CLI 运行 Open Flow。

### Docker Compose

仓库根目录提供 `docker-compose.yml`，以相同的端口和 volume 运行已发布的镜像。其中列出的变量从你的 shell 读取，未设置的会被省略，从而使用镜像默认值:

```bash
export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"
docker compose up -d
docker compose logs -f open-flow
```

要运行指定 tag，在每次执行 compose 命令 (包括下面的升级命令) 之前先在 shell 中 export `OPEN_FLOW_IMAGE_TAG`，否则固定的 Release 会回退到 `tip`: `export OPEN_FLOW_IMAGE_TAG=v0.1.0-beta.1`。

### 从源码构建

如果要自行构建镜像而不是拉取，加上 build overlay。它会构建 `apps/server/Dockerfile`，并用 `docker-compose.yml` 中相同的名字打 tag:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

## 升级

拉取新 tag，然后用同一个 volume 重新创建容器。Server 启动时会执行待执行的 SQLite migration；停止时会在 30 秒期限内让进行中的 Run 结束:

```bash
docker compose pull
docker compose up -d
```

同一时间只能有一个 Server 容器写入数据卷。不要在旧容器仍在使用同一 volume 时启动新容器；升级生产环境前先做
[quiesced backup](../container-delivery.md#6-持久化与恢复)。
