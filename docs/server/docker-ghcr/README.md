# Docker Image (GHCR)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow ships a prebuilt Server image on the GitHub Packages container registry (GHCR), so you
can run it without cloning the repository or building anything. The image is:

```text
ghcr.io/oomol-lab/open-flow
```

It contains exactly what [the container delivery reference](../container-delivery.md) describes:
one Server process with the Workbench, Control API, Run runtime, Trigger runtime, and SQLite
migrations. Configuration, health checks, persistence, and backup are documented there and are not
repeated here.

## Choose A Tag

| Tag             | Points at                                              | Use it when                                                    |
| --------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| `latest`        | the newest stable release                              | you want the current stable Server                             |
| `<release-tag>` | a specific release such as `v0.1.0-beta.1` (immutable) | you deploy to production and want a pinned, reproducible build |
| `tip`           | the latest commit on `main`                            | you want to try changes that are not released yet              |
| `<short-sha>`   | a specific `main` commit (immutable)                   | you want to pin an exact pre-release build                     |

Every GitHub Release publishes its tag. A stable release also moves `latest`; a pre-release does
not, so `latest` never points at a beta. Every push to `main` publishes `tip` and the short commit
hash. A tag published by a newer build replaces the older one under the same name, so `latest` and
`tip` move while release tags and commit hashes stay fixed.

Open Flow is in beta: `latest` appears with the first stable release, so until then use `tip` or a beta release tag such as `v0.1.0-beta.1`. For production, pin a release tag instead of `latest`.

## Pull

The image is public, so no sign-in is required:

```bash
docker pull ghcr.io/oomol-lab/open-flow:tip
```

If you get an `unauthorized` or `denied` error, sign in with a GitHub token that has the
`read:packages` scope:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

The image is multi-arch (`linux/amd64` + `linux/arm64`). Each architecture is built natively, so
Docker pulls the variant that matches your machine, including Apple Silicon and AWS Graviton, with no
`--platform` flag.

## Run

The image listens on port `3000`, binds to `0.0.0.0`, and stores SQLite in `/data/open-flow`.
Mount a volume there so data survives restarts.

The Server accepts an operator token from the environment. Generate one with at least 32 bytes and
keep it somewhere safe. It signs you in to the Workbench and works as the Bearer token for the
Control API:

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

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) and sign in with the token. If you omit
`OPEN_FLOW_TOKEN`, the first start prints a one-time setup code in the logs and the Workbench asks for
it before you set a token; see [Start](../container-delivery.md#3-启动) for the claim flow.

To connect a Connector or an LLM service, add the variables from the
[configuration table](../container-delivery.md#4-配置). The
[self-hosted stack guide](../self-hosted-stack/README.md) walks through running Open Flow with
OpenConnector and the oo CLI.

### Docker Compose

The repository root ships a `docker-compose.yml` that runs the published image with the same port
and volume. Variables listed there are read from your shell and omitted when unset, so the image
defaults apply:

```bash
export OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"
docker compose up -d
docker compose logs -f open-flow
```

To run a specific tag, export `OPEN_FLOW_IMAGE_TAG` in the shell before every compose command, including the upgrade commands below, so a pinned release does not fall back to `tip`: `export OPEN_FLOW_IMAGE_TAG=v0.1.0-beta.1`.

### Build From Source

To build the image yourself instead of pulling it, add the build overlay. It builds
`apps/server/Dockerfile` and tags the result with the same name that `docker-compose.yml` uses:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build
```

## Upgrade

Pull the new tag, then recreate the container with the same volume. The Server runs pending SQLite
migrations on start, and stopping it lets in-flight Runs drain within the 30 second deadline:

```bash
docker compose pull
docker compose up -d
```

Only one Server container may write a data volume at a time. Do not start the new container while
the old one is still running against the same volume, and take a
[quiesced backup](../container-delivery.md#6-持久化与恢复) before upgrading production.
