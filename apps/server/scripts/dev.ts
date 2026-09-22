import type { ChildProcess } from 'node:child_process'
import type { Plugin, ViteDevServer } from 'vite'

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { Agent } from 'node:http'
import { connect, createServer } from 'node:net'
import path from 'node:path'
import { loadEnvFile } from 'node:process'

const appRoot = path.resolve(import.meta.dirname, '..')
const workspaceEnvPath = path.resolve(appRoot, '../..', '.env')
const developmentStateDirectory = path.join(appRoot, '.open-flow-dev')
const operatorTokenPath = path.join(developmentStateDirectory, 'operator-token')
const backendReadyTimeoutMs = 10_000

export function developmentBackendAgent(): Agent {
  const agent = new Agent({ keepAlive: false })
  agent.createConnection = (options, callback) => {
    const deadline = Date.now() + backendReadyTimeoutMs
    const attempt = (): void => {
      const socket = Agent.prototype.createConnection(options)!
      const failed = (error: NodeJS.ErrnoException): void => {
        if (error.code == 'ECONNREFUSED' && Date.now() < deadline) {
          setTimeout(attempt, 50).unref()
        } else callback!(error, socket)
      }
      socket.once('error', failed)
      socket.once('connect', () => {
        socket.off('error', failed)
        callback!(null, socket)
      })
    }
    // Buffer the request until connected; never replay a request sent to the backend.
    attempt()
    return undefined
  }
  return agent
}

export function developmentBackendPlugin(): Plugin {
  if (existsSync(workspaceEnvPath)) loadEnvFile(workspaceEnvPath)
  const backendPort = readBackendPort()
  process.env.OPEN_FLOW_DEV_API_ORIGIN = `http://127.0.0.1:${backendPort}`
  let backend: ChildProcess | undefined
  let backendResult: Promise<void> | undefined
  let stopping = false

  return {
    name: 'open-flow-development-backend',
    apply: 'serve',
    async configureServer(server) {
      const waitPublicOrigin = process.env.OPEN_FLOW_PUBLIC_ORIGIN ?? `http://127.0.0.1:${backendPort}`
      const configuredOperatorToken = process.env.OPEN_FLOW_TOKEN
      if (configuredOperatorToken != null && Buffer.byteLength(configuredOperatorToken) < 32) {
        throw new Error('OPEN_FLOW_TOKEN must contain at least 32 UTF-8 bytes. Remove it to use a generated development token.')
      }
      if (!(await portAvailable(backendPort))) {
        throw new Error(`Server API port ${backendPort} is already in use. Stop the existing process or set OPEN_FLOW_PORT.`)
      }

      const developmentToken = configuredOperatorToken == null ? await loadDevelopmentToken() : { created: false, token: configuredOperatorToken }
      backend = spawn('node', ['--watch', '--no-node-snapshot', 'node/main.ts', '--api-only'], {
        cwd: appRoot,
        env: {
          ...process.env,
          OPEN_FLOW_HOST: '127.0.0.1',
          OPEN_FLOW_LOG_LEVEL: process.env.OPEN_FLOW_LOG_LEVEL ?? 'debug',
          OPEN_FLOW_PUBLIC_ORIGIN: waitPublicOrigin,
          OPEN_FLOW_TOKEN: developmentToken.token,
          OPEN_FLOW_PORT: String(backendPort),
        },
        stdio: 'inherit',
      })
      backendResult = completed(backend)

      process.stdout.write(
        `Development endpoints:\n  Workbench: http://localhost:5174\n  Server API: http://127.0.0.1:${backendPort}\n  Wait actions: ${waitPublicOrigin}\n`,
      )
      if (configuredOperatorToken == null) {
        const action = developmentToken.created ? 'created' : 'reused'
        process.stdout.write(`Server operator token (${action} at ${path.relative(appRoot, operatorTokenPath)}): ${developmentToken.token}\n`)
      }

      try {
        await Promise.race([waitForPort(backendPort), backendResult])
      } catch (error) {
        await stopBackend()
        throw error
      }
      if (backend.exitCode != null || backend.signalCode != null) {
        throw new Error('Server backend exited before becoming ready.')
      }
      void backendResult.then(
        () => closeAfterBackendExit(server),
        (error: unknown) => closeAfterBackendExit(server, error),
      )
    },
    async closeBundle() {
      await stopBackend()
    },
  }

  function closeAfterBackendExit(server: ViteDevServer, error?: unknown): void {
    if (stopping) return
    process.exitCode = 1
    process.stderr.write(`${error instanceof Error ? error.message : 'Server backend exited unexpectedly.'}\n`)
    void server.close()
  }

  async function stopBackend(): Promise<void> {
    if (backend == null || backendResult == null) return
    stopping = true
    backend.kill('SIGTERM')
    await backendResult.catch(() => {})
  }
}

function completed(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code == 0 || signal == 'SIGTERM') resolve()
      else reject(new Error(`Server backend exited with ${signal ?? `code ${code ?? 'unknown'}`}.`))
    })
  })
}

function readBackendPort(): number {
  const port = Number(process.env.OPEN_FLOW_PORT ?? '3001')
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('OPEN_FLOW_PORT must be an integer between 1 and 65535 in development.')
  }
  return port
}

async function portAvailable(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close((error) => resolve(error == null)))
  })
}

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + backendReadyTimeoutMs
  while (Date.now() < deadline) {
    if (await portListening(port)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Server backend did not listen on port ${port} within ${backendReadyTimeoutMs}ms.`)
}

async function portListening(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => socket.destroy())
    socket.once('close', (hadError) => resolve(!hadError))
    socket.once('error', () => {})
  })
}

async function loadDevelopmentToken(): Promise<{ readonly created: boolean; readonly token: string }> {
  try {
    const token = (await readFile(operatorTokenPath, 'utf8')).trim()
    if (Buffer.byteLength(token) < 32) {
      throw new Error(`Development operator token at ${operatorTokenPath} must contain at least 32 UTF-8 bytes.`)
    }
    return { created: false, token }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code != 'ENOENT') throw error
  }

  await mkdir(developmentStateDirectory, { recursive: true })
  const token = randomBytes(32).toString('base64url')
  await writeFile(operatorTokenPath, token, { encoding: 'utf8', mode: 0o600 })
  return { created: true, token }
}
