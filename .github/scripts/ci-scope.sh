#!/usr/bin/env bash
set -euo pipefail

command=false
package=false
server=false
server_image=false

while IFS= read -r file; do
  case "$file" in
    .bun-version | .dockerignore | .github/workflows/* | .github/scripts/ci-scope.sh | .node-version | LICENSE | NOTICE | bun.lock | package.json)
      command=true
      package=true
      server=true
      ;;
    packages/open-flow/*)
      command=true
      package=true
      server=true
      ;;
    packages/command/*)
      command=true
      package=true
      ;;
    apps/server/*)
      server=true
      ;;
  esac

  case "$file" in
    *.test.* | *.spec.* | *.md | */AGENTS.md | docs/* | */test/* | */tests/* | packages/open-flow/dev/* | .agents/*)
      continue
      ;;
    .bun-version | .node-version | .dockerignore | bun.lock | package.json | packages/*/package.json | apps/server/package.json | LICENSE | NOTICE)
      server_image=true
      ;;
    .github/workflows/ci.yaml | .github/workflows/publish-docker.yaml | .github/scripts/ci-scope.sh)
      server_image=true
      ;;
    apps/server/Dockerfile | apps/server/scripts/build.ts | apps/server/scripts/check-docker.ts | apps/server/vite.config.ts | apps/server/tsconfig.json)
      server_image=true
      ;;
    apps/server/node/* | apps/server/migrations/* | packages/open-flow/src/build/* | packages/open-flow/src/execution/*)
      server_image=true
      ;;
    apps/server/browser/* | apps/server/common/* | apps/server/index.html | packages/open-flow/src/* | assets/*)
      if [ "$EVENT_NAME" = "push" ]; then server_image=true; fi
      ;;
  esac
done

echo "command=$command"
echo "package=$package"
echo "server=$server"
echo "server_image=$server_image"
