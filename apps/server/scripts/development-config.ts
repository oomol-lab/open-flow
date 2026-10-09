import { existsSync } from 'node:fs'
import path from 'node:path'
import { loadEnvFile } from 'node:process'

export const appRoot = path.resolve(import.meta.dirname, '..')
export const workspaceRoot = path.resolve(appRoot, '../..')
export const developmentStateDirectory = path.join(appRoot, '.open-flow-dev')
export const operatorTokenPath = path.join(developmentStateDirectory, 'operator-token')
export const developmentWorkbenchOrigin = 'http://localhost:5174'

export function loadDevelopmentEnvironment(): void {
  const file = path.join(workspaceRoot, '.env')
  if (existsSync(file)) loadEnvFile(file)
}

export function readBackendPort(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const port = Number(env.OPEN_FLOW_PORT ?? '3001')
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('OPEN_FLOW_PORT must be an integer between 1 and 65535 in development.')
  }
  return port
}

export function developmentApiOrigin(env: Readonly<Record<string, string | undefined>>): string {
  return `http://127.0.0.1:${readBackendPort(env)}`
}
