# Fly.io 部署

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow Server 可以作为 Node Docker runtime 部署到 Fly.io。本部署使用仓库的 `apps/server/Dockerfile`、根目录的 `fly.toml`，以及挂载到
`/data/open-flow` 的 Fly volume。Fly 负责 TLS 终止、远程 Docker 构建、健康检查、滚动部署和可选的自定义域名。

部署边界与[容器交付参考](../container-delivery.md)相同：单个 Server machine、单个 SQLite writer。machine 数量不能超过 1。

## 1. 前提

- Fly.io 账号。
- 已安装 `flyctl` 并通过 `fly auth login` 登录。
- 本地 Docker，或使用 Fly remote builder。`apps/server/Dockerfile` 使用 BuildKit 语法，remote builder 支持该语法。

## 2. 创建应用

先创建应用，不立即部署：

```bash
fly apps create my-open-flow
```

Fly app 名称全局唯一。使用其他名称时，部署前更新 `fly.toml` 的 `app` 字段：

```toml
app = "my-open-flow"
```

## 3. 创建数据卷

镜像把 SQLite 保存在 `/data/open-flow`。创建与 `fly.toml` 中 `source` 同名的 volume：

```bash
fly volumes create open_flow_data \
  --region iad \
  --size 1 \
  --app my-open-flow
```

Run 历史和 RunEvent 会持续占用空间。预期 Run 量较大时增大 `--size`，或之后用 `fly volumes extend` 扩容。

## 4. 设置 secret

operator token 至少包含 32 UTF-8 bytes，通过 Fly secret 注入，不要写进 `fly.toml`：

```bash
OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"

fly secrets set \
  OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  --app my-open-flow
```

把 `OPEN_FLOW_TOKEN` 保存到密码管理器。它同时用于 Workbench 登录和 Control API 的 Bearer token。

`fly.toml` 已把 `OPEN_FLOW_SESSION_COOKIE_SECURE` 设为 `true`：`force_https` 会把明文请求重定向到 HTTPS，浏览器只通过 TLS 访问 Server。

需要 Connector 时再设置以下 secret：

```bash
fly secrets set \
  OPEN_FLOW_CONNECTOR_ORIGIN="https://connector.example.com" \
  OPEN_FLOW_CONNECTOR_TOKEN="replace-with-a-scoped-runtime-token" \
  OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN="https://connector.example.com" \
  --app my-open-flow
```

OpenConnector 部署在同一个 Fly 组织时，runtime origin 可以使用 Fly 私有网络地址，例如 `http://my-open-connector.internal:3000`；
console origin 仍然必须是用户浏览器可访问的 HTTPS 公网地址。

需要 Provider Integration 时再设置 callback origin 和 key：

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://my-open-flow.fly.dev" \
  OPEN_FLOW_INTEGRATION_CALLBACK_KEY="$(openssl rand -hex 32)" \
  --app my-open-flow
```

`fly secrets set` 会重新部署 machine。完整环境变量和各 origin 的约束见[容器交付参考](../container-delivery.md#4-配置)。

## 5. 部署

从仓库根目录部署：

```bash
fly deploy --config fly.toml --remote-only --ha=false
```

`--ha=false` 阻止 Fly 为新应用创建第二台 machine。Server 只允许一个 SQLite writer，而每台 machine 各自挂载独立 volume，两台 machine 会持有两份互不
相干的状态。之后的每次部署都保持 machine 数量为 1，不要用 `fly scale count` 超过 1。

`fly.toml` 使用：

- `apps/server/Dockerfile` 构建镜像，构建上下文是仓库根目录；
- `internal_port = 3000` 对应镜像默认端口；
- `GET /readyz` 作为 HTTP 健康检查。Server 未启动、后台处理停止或配置的 Connector 不可用时返回 503，Fly 停止向该 machine 转发流量并让部署失败。
  只需要进程存活检查时可改为 `/healthz`；
- `kill_signal = "SIGTERM"` 和 `kill_timeout = "45s"`。Server 收到信号后最多等待 30 秒完成 Run drain 和 SQLite 关闭，宽限期必须大于 30 秒；
- `auto_stop_machines = "off"` 和 `min_machines_running = 1`。Cron 和 Poll Trigger 只在 machine 运行时触发。

## 6. 验证

```bash
curl https://my-open-flow.fly.dev/healthz
curl https://my-open-flow.fly.dev/readyz
```

预期分别返回 `{"status":"ok"}` 和 `{"status":"ready"}`。打开 `https://my-open-flow.fly.dev`，用 `OPEN_FLOW_TOKEN` 登录 Workbench。

诊断部署或启动问题时查看日志：

```bash
fly logs --app my-open-flow
```

## 7. 自定义域名

```bash
fly certs add flow.example.com --app my-open-flow
```

按 Fly 输出创建 DNS 记录后检查证书状态：

```bash
fly certs check flow.example.com --app my-open-flow
```

配置了 Integration callback 时，把 `OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN` 更新为新域名：

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://flow.example.com" \
  --app my-open-flow
```

## 8. 更新

```bash
git pull
fly deploy --config fly.toml --remote-only
```

volume 保留 `open-flow.sqlite` 及其 WAL/SHM 文件。SQLite migration 在 Server 启动时按顺序执行，不需要额外步骤。

## 9. 备份

Fly 会自动创建 volume snapshot，但 Server 只承诺 quiesced backup。需要一致备份时先停止 machine，再创建 snapshot：

```bash
fly machine stop <machine-id> --app my-open-flow
fly volumes snapshots create <volume-id> --app my-open-flow
fly volumes snapshots list <volume-id> --app my-open-flow
fly machine start <machine-id> --app my-open-flow
```

snapshot 异步创建。保持 machine 停止，直到 `fly volumes snapshots list` 显示新 snapshot 的状态为 `created`，再启动 machine。

machine id 和 volume id 分别来自 `fly machine list` 和 `fly volumes list`。

## 10. 扩缩容与休眠

- 保持 machine 数量为 1。需要更多资源时调整 `fly.toml` 中 `[[vm]]` 的 `size` 和 `memory`，然后重新部署。
- 默认 `memory = "1gb"`。每个 Run 的 Isolated VM 默认上限 128 MB，`OPEN_FLOW_MAX_CONCURRENT_RUNS` 默认 4，再加上 Node 进程本身。提高并发时同步提高内存。
- 只使用手动 Run 和 Webhook、且可以接受冷启动时，可改为 `auto_stop_machines = "suspend"` 和 `min_machines_running = 0`。machine 休眠期间 Cron 和
  Poll Trigger 不会触发，首个 Webhook 请求要等待 machine 唤醒。
