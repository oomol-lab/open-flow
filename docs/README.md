# Open Flow documentation

This directory contains current product boundaries, technical contracts, usage guides, and deployment references.
For the product overview and quick start, see the [project README](../README.md) ([Simplified Chinese](README.zh-CN.md)).

## Product and technical contracts

- [Product and architecture boundaries](architecture.md)
- [Control API reference](control/contracts/control-api.md)
- [Public contracts and version evolution](control/contracts/compatibility.md)
- [Node compatibility runtime contract](control/contracts/nodejs-runtime.md)
- [Command Artifact v2 distribution contract](distribution/command-artifact.md)

## Flow authoring and node development

- [Public node read and edit contract](control/contracts/control-api.md#node-authoring)
- [Node authoring development guide](authoring/node-authoring.md)
- [CLI Lab verification guide](authoring/cli-lab.md)

## Connections and permissions

- [Flow authorization model](control/flow-authorization.md)
- [Trigger permissions and execution](control/trigger-permissions.md)

## Trigger guides

- [Flow Error](triggers/error-trigger.md)
- [Linear Issue Trigger](triggers/linear-trigger.md)

## Server and deployment

- [Server container delivery](server/container-delivery.md)
- [MCP integration](server/mcp.md)
- [Users, login, and permissions](server/users.md)
- [Docker images (GHCR)](server/docker-ghcr/README.md) ([Simplified Chinese](server/docker-ghcr/README.zh-CN.md))
- [Fly.io deployment](server/fly-io/README.md) ([Simplified Chinese](server/fly-io/README.zh-CN.md))
- [Run Open Flow with OpenConnector and the oo CLI](server/self-hosted-stack/README.md) ([Simplified Chinese](server/self-hosted-stack/README.zh-CN.md))

## Development and documentation maintenance

- [Contributing](../CONTRIBUTING.md)
- [Development principles and verification requirements](../AGENTS.md)
- [Workbench and Designer frontend guidance](../.agents/skills/frontend-ui/SKILL.md)
- [Lab Story development](../packages/open-flow/dev/designer/README.md)

The architecture document owns product boundaries and runtime invariants. Technical references own exact fields and protocols.
Usage and deployment guides belong in their respective topic directories.
`README.<locale>.md` files translate the project README. `assets/` stores its images.
Use Git history to trace implementation plans, migrations, and verification records.
Historical tasks do not establish current capabilities or completed verification.
