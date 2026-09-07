import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { commandArtifactEntryFile, commandArtifactManifestFile, commandArtifactVersion } from '../src/distribution/common/commandArtifact.ts'
import { decodeCommandArchive, extractCommandArchive } from '../src/distribution/node/commandArchive.ts'

const execFileAsync = promisify(execFile)
const rootPath = path.resolve(import.meta.dirname, '..')
const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-command-'))

try {
  const firstArchive = await buildCommandArchive()
  const secondArchive = await buildCommandArchive()
  assert.deepEqual(secondArchive, firstArchive, 'Command archive bytes changed between builds.')

  const decoded = await decodeCommandArchive(firstArchive)
  assert.equal(decoded.manifest.version, commandArtifactVersion)
  assert.deepEqual(
    decoded.files.map((file) => file.path).toSorted(),
    ['LICENSE', 'LICENSE.md', 'NOTICE', commandArtifactEntryFile, commandArtifactManifestFile].toSorted(),
  )
  assert.equal(decoded.files.find((file) => file.path == commandArtifactEntryFile)?.mode, 0o755)

  const extractedRoot = path.join(directory, 'open-flow-command')
  await extractCommandArchive(firstArchive, async (entry) => {
    const outputPath = path.join(extractedRoot, entry.path)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, entry.bytes, { mode: entry.mode })
  })

  const entryPath = path.join(extractedRoot, commandArtifactEntryFile)
  assert.ok(((await stat(entryPath)).mode & 0o111) != 0)
  const entrySource = await readFile(entryPath, 'utf8')
  assert.doesNotMatch(entrySource, /src\/(?:compiler|flow\/node|runtime|workbench)\//)
  const version = await execFileAsync(process.execPath, [entryPath, '--version', '--json'])
  assert.equal(version.stderr, '')
  assert.deepEqual(JSON.parse(version.stdout), { version: decoded.manifest.openFlowVersion })

  const help = await execFileAsync(process.execPath, [entryPath, 'runs', 'wait', '--help', '--json'])
  assert.equal(help.stderr, '')
  assert.equal(JSON.parse(help.stdout).commands[0].command, 'runs wait')
  const schema = await execFileAsync(process.execPath, [entryPath, 'schema', 'graph.node.input.set', '--json'])
  assert.equal(schema.stderr, '')
  assert.equal(JSON.parse(schema.stdout).properties.kind.const, 'graph.node.input.set')
  await assert.rejects(execFileAsync(process.execPath, [entryPath, 'list', '--json']), (error: unknown) => {
    assert.ok(error != null && typeof error == 'object' && 'stderr' in error)
    assert.equal(JSON.parse(String(error.stderr)).error.code, 'host.unavailable')
    return true
  })

  const firstCwd = path.join(directory, 'first-cwd')
  const secondCwd = path.join(directory, 'second-cwd')
  await Promise.all([mkdir(firstCwd), mkdir(secondCwd)])

  const first = await runSmoke(entryPath, firstCwd, false)
  assert.equal(first.stderr, '')
  assert.deepEqual(
    first.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).kind),
    ['flow.create', 'flow.check'],
  )

  const second = await runSmoke(entryPath, secondCwd, true)
  assert.equal(second.stderr, '')
  assert.deepEqual(JSON.parse(second.stdout), { flows: [flow()], kind: 'flow.list', version: 1 })

  console.log('Verified deterministic Command Artifact v2 and Flow Control API CLI smoke tests from two working directories.')
} finally {
  await rm(directory, { force: true, recursive: true })
}

async function buildCommandArchive(): Promise<Uint8Array> {
  await execFileAsync(process.execPath, [path.join(rootPath, 'scripts/build.ts'), '--quiet'], { cwd: rootPath })
  const archives = (await readdir(path.join(rootPath, 'dist/release'))).filter((file) => file.endsWith('.tar.gz'))
  assert.equal(archives.length, 1)
  return await readFile(path.join(rootPath, 'dist/release', archives[0]!))
}

async function runSmoke(entryPath: string, cwd: string, readOnly: boolean): Promise<{ readonly stderr: string; readonly stdout: string }> {
  return await execFileAsync(process.execPath, ['-e', smokeScript(pathToFileURL(entryPath).href, readOnly)], {
    cwd,
    env: { ...process.env, BUN_CONFIG_NO_INSTALL: '1' },
  })
}

function smokeScript(entryUrl: string, readOnly: boolean): string {
  return `
import assert from 'node:assert/strict'

const entry = await import(${JSON.stringify(entryUrl)})
assert.equal('requiredBunVersion' in entry, false)
let flow = ${readOnly ? JSON.stringify(flow()) : 'undefined'}
const requests = []
const host = {
  async cloudRequest(path, init = {}) {
    requests.push({ path, init })
    if (path === '/v1/flows?limit=100') return Response.json({ flows: flow == null ? [] : [flow], version: 1 })
    if (path === '/v1/flows/Main') {
      return Response.json({ error: { code: 'flow.not-found', message: 'Missing.' }, version: 1 }, { status: 404 })
    }
    if (path === '/v1/flows' && init.method === 'POST') {
      const body = JSON.parse(String(init.body))
      flow = {
        createdAt: '2026-08-14T00:00:00.000Z',
        draftRevisionId: 'revision-1',
        flowId: 'flow-1',
        name: body.name,
        status: 'active',
        updatedAt: '2026-08-14T00:00:00.000Z',
        version: 1,
      }
      return Response.json(flow, { status: 201 })
    }
    if (path === '/v1/flows/flow-1/revisions/revision-1/check') {
      return Response.json({
        closureDigest: 'closure-1',
        diagnostics: [],
        engineContract: 'open-flow-engine/v2',
        flowId: 'flow-1',
        modelVersion: 1,
        revisionDigest: 'digest-revision-1',
        revisionId: 'revision-1',
        valid: true,
        version: 1,
      })
    }
    throw new Error(\`Unexpected Control API request: \${init.method ?? 'GET'} \${path}\`)
  },
  async getWorkbenchUrl(flowId) {
    return 'https://console.example/team/example/flows' + (flowId == null ? '' : '/' + encodeURIComponent(flowId))
  },
}

const commands = ${JSON.stringify(
    readOnly
      ? [['list', '--json']]
      : [
          ['create', 'Main', '--json'],
          ['check', 'Main', '--json'],
        ],
  )}
for (const args of commands) assert.equal(await entry.runOpenFlowCommand(args, host), 0)
const creations = requests.filter(({ path, init }) => path === '/v1/flows' && init.method === 'POST')
assert.equal(creations.length, ${readOnly ? 0 : 1})
if (creations.length === 1) assert.equal(new Headers(creations[0].init.headers).has('idempotency-key'), true)
`
}

function flow() {
  return {
    createdAt: '2026-08-14T00:00:00.000Z',
    draftRevisionId: 'revision-1',
    flowId: 'flow-1',
    name: 'Main',
    status: 'active',
    updatedAt: '2026-08-14T00:00:00.000Z',
    version: 1,
  }
}
