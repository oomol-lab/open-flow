import type { OpenFlowCommandHost } from '@oomol-lab/open-flow-command/development'

import { readFile } from 'node:fs/promises'
import { developmentApiOrigin, developmentWorkbenchOrigin, operatorTokenPath } from './development-config.ts'

/** A development host for the production CLI; deployment credentials stay here. */
export function createDevelopmentCommandHost(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: { readToken?: () => Promise<string>; fetch?: (url: URL, init: RequestInit) => Promise<Response> } = {},
): OpenFlowCommandHost {
  let connection: Promise<{ origin: string; token: string; workbenchOrigin: string }> | undefined
  const resolveConnection = () =>
    (connection ??= resolve().catch((error) => {
      connection = undefined
      throw error
    }))
  return {
    async cloudRequest(path, init = {}) {
      const { origin, token } = await resolveConnection()
      const url = new URL(path, origin)
      if (url.origin != origin || !url.pathname.startsWith('/v1/') || url.username || url.password || url.hash) {
        throw new Error('Flow requests must target the selected Server /v1/ API.')
      }
      const headers = new Headers(init.headers)
      for (const name of ['cookie', 'x-oo-team-id', 'x-oo-team-name', 'x-oomol-token']) headers.delete(name)
      headers.set('authorization', `Bearer ${token}`)
      try {
        return await (dependencies.fetch ?? fetch)(url, { ...init, headers, redirect: 'error' })
      } catch {
        throw new Error(`Could not reach Open Flow Server at ${origin}. Start bun run dev for the local deployment, or check OPEN_FLOW_URL.`)
      }
    },
    async getWorkbenchUrl(flowId) {
      const { workbenchOrigin } = await resolveConnection()
      return new URL(flowId == null ? '/flows' : `/flows/${encodeURIComponent(flowId)}/design`, workbenchOrigin).href
    },
  }

  async function resolve() {
    const explicitUrl = env.OPEN_FLOW_URL?.trim()
    if (env.OPEN_FLOW_URL != null && !explicitUrl) throw new Error('OPEN_FLOW_URL must be a Server origin.')
    const url = new URL(explicitUrl ?? developmentApiOrigin(env))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname != '/' || url.search || url.hash) {
      throw new Error('OPEN_FLOW_URL must be an HTTP(S) origin without credentials, path, query or fragment.')
    }
    let token = env.OPEN_FLOW_TOKEN
    if (token == null) {
      if (explicitUrl != null) throw new Error('An explicit OPEN_FLOW_URL requires OPEN_FLOW_TOKEN; the local development token is not used.')
      try {
        token = await (dependencies.readToken ?? (() => readFile(operatorTokenPath, 'utf8')))()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code != 'ENOENT') throw new Error('Could not read the development operator token.', { cause: error })
        throw new Error('Development operator token is missing. Start bun run dev, or provide OPEN_FLOW_TOKEN.', { cause: error })
      }
    }
    token = token.trim()
    if (Buffer.byteLength(token) < 32) throw new Error('The Server token must contain at least 32 UTF-8 bytes.')
    return { origin: url.origin, token, workbenchOrigin: explicitUrl == null ? developmentWorkbenchOrigin : url.origin }
  }
}
