import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./ci-scope.sh', import.meta.url))

function scope(files, event = 'pull_request') {
  const result = spawnSync('bash', [script], {
    input: files.join('\n') + '\n',
    encoding: 'utf8',
    env: { ...process.env, EVENT_NAME: event },
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  return Object.fromEntries(
    result.stdout
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  )
}

test('test-only changes retain source suites without starting containers', () => {
  assert.deepEqual(
    scope(['packages/open-flow/src/execution/common/scheduler.test.ts', 'packages/open-flow/test/waitHost.ts', 'apps/server/test/settingsPage.test.tsx']),
    { command: 'true', package: 'true', server: 'true', server_image: 'false' },
  )
})

test('documentation and Lab changes skip image validation on PRs and main', () => {
  for (const event of ['pull_request', 'push']) {
    assert.equal(scope(['docs/deployment.md', 'apps/server/README.md', 'packages/open-flow/dev/designer/story.tsx'], event).server_image, 'false')
  }
})

test('product, Server UI and asset changes get image validation on main only', () => {
  for (const file of [
    'packages/open-flow/src/ui/browser/dialog.tsx',
    'packages/open-flow/src/flow/common/schema.ts',
    'apps/server/browser/main.tsx',
    'apps/server/common/users.ts',
    'apps/server/index.html',
    'assets/logo/icon.svg',
  ]) {
    assert.equal(scope([file]).server_image, 'false', file)
    assert.equal(scope([file], 'push').server_image, 'true', file)
  }
})

test('delivery changes require image validation before merge', () => {
  for (const file of [
    'apps/server/Dockerfile',
    '.dockerignore',
    'bun.lock',
    '.node-version',
    'packages/command/package.json',
    'apps/server/scripts/build.ts',
    'apps/server/scripts/check-docker.ts',
    'apps/server/vite.config.ts',
    'apps/server/node/main.ts',
    'apps/server/node/storage/database.ts',
    'apps/server/migrations/001.sql',
    'packages/open-flow/src/execution/common/scheduler.ts',
    'packages/open-flow/src/build/node/providerIcons.ts',
    '.github/scripts/ci-scope.sh',
    '.github/workflows/ci.yaml',
  ])
    assert.equal(scope([file]).server_image, 'true', file)
})

test('mixed changes cannot clear an image requirement', () => {
  const files = ['apps/server/Dockerfile', 'packages/open-flow/test/scheduler.test.ts', 'docs/deployment.md']
  assert.equal(scope(files).server_image, 'true')
  assert.equal(scope(files.toReversed()).server_image, 'true')
})

test('command-only changes retain their package checks without Server validation', () => {
  assert.deepEqual(scope(['packages/command/src/main.ts']), {
    command: 'true',
    package: 'true',
    server: 'false',
    server_image: 'false',
  })
})

test('unrelated workflow changes do not require a Server image', () => {
  assert.equal(scope(['.github/workflows/star-history.yaml']).server_image, 'false')
})
