import type { JsonValue, ManagedTaskDefinition } from '../../flow/common/change.ts'
import type { OpenApiAuth, OpenApiExecutor } from '../../openapi/common/openapi.ts'

import { dequal } from 'dequal/lite'
import { z } from 'zod'
import { httpUrl, openApiTask, securityOptions, selectOperation, serverAddress, servers, snapshot } from '../../openapi/common/openapi.ts'

const authenticationSchema = z.union([
  z.strictObject({
    schemes: z.array(z.string().min(1)).describe('One complete security alternative advertised by this operation; [] selects no authentication.'),
  }),
  z.strictObject({ type: z.enum(['bearer', 'basic']) }),
  z.strictObject({ type: z.literal('apiKey'), name: z.string().min(1), in: z.enum(['header', 'query']) }),
])

export const authoringOpenApiSchema = z.strictObject({
  sourceUrl: z.string().min(1),
  path: z.string().min(1),
  method: z.string().min(1),
  serverUrl: z.string().optional(),
  authentication: authenticationSchema.optional().describe('Omit to use the operation default. Bind credentials through the advertised node inputs.'),
})

export type AuthoringOpenApiConfig = z.infer<typeof authoringOpenApiSchema>

export function openApiAuthenticationChoices(config: OpenApiExecutor) {
  try {
    return securityOptions(config.document, config.path, config.method).map(({ label, auth, error }) =>
      Object.assign({ label }, auth == null ? { error } : { authentication: { schemes: auth.map((item) => item.id) } }),
    )
  } catch (error) {
    // Reading an incomplete saved draft must not require a valid operation snapshot.
    return [{ label: 'Saved operation', error: (error as Error).message }]
  }
}

function authenticationView(config: OpenApiExecutor): NonNullable<AuthoringOpenApiConfig['authentication']> {
  const schemes = config.auth.map((item) => item.id)
  const declared = openApiAuthenticationChoices(config).some((option) => 'authentication' in option && dequal(option.authentication?.schemes, schemes))
  if (!declared && config.auth.length == 1) {
    const { id: _id, ...manual } = config.auth[0]!
    return manual as NonNullable<AuthoringOpenApiConfig['authentication']>
  }
  return { schemes }
}

export function openApiConfigView(config: OpenApiExecutor): AuthoringOpenApiConfig {
  return {
    sourceUrl: config.sourceUrl,
    path: config.path,
    method: config.method,
    serverUrl: config.serverUrl,
    authentication: authenticationView(config),
  }
}

export class AuthoringOpenApiAuthenticationError extends Error {
  readonly code = 'openapi.authentication-invalid'
  readonly details: { field: string; choices: ReturnType<typeof openApiAuthenticationChoices> }
  constructor(config: OpenApiExecutor) {
    super('Choose one complete authentication alternative advertised by this operation, or configure manual authentication.')
    this.name = 'AuthoringOpenApiAuthenticationError'
    this.details = { field: 'config.authentication', choices: openApiAuthenticationChoices(config) }
  }
}

function prepareAuthentication(config: OpenApiExecutor, choice: NonNullable<AuthoringOpenApiConfig['authentication']>): readonly OpenApiAuth[] {
  if (!('schemes' in choice)) return [{ id: 'manual', ...choice }]
  const names = new Set(choice.schemes)
  const matched = securityOptions(config.document, config.path, config.method).find(
    (option) =>
      option.auth != null && names.size == choice.schemes.length && option.auth.length == names.size && option.auth.every((auth) => names.has(auth.id)),
  )
  if (matched?.auth == null) throw new AuthoringOpenApiAuthenticationError(config)
  return matched.auth
}

/** Operation snapshots and credential handles remain stable until their business selection changes. */
export async function prepareOpenApiTask(
  config: AuthoringOpenApiConfig,
  previous: ManagedTaskDefinition | undefined,
  fetch: (url: string) => Promise<JsonValue>,
  name: string,
  explicit: { authentication?: boolean; serverUrl?: boolean } = {},
): Promise<ManagedTaskDefinition> {
  const current = previous?.executor.kind == 'openapi' ? previous.executor : undefined
  const changed = current == null || config.sourceUrl != current.sourceUrl || config.path != current.path || config.method != current.method
  const authentication = changed && current != null && !explicit.authentication ? undefined : config.authentication
  let selected: OpenApiExecutor
  if (!changed) selected = current
  else {
    const document = await fetch(config.sourceUrl)
    if (authentication != null && !('schemes' in authentication)) {
      // Manual access tokens also support operations whose declared OAuth scheme is unsupported.
      const saved = snapshot(document, config.path, config.method)
      selected = {
        kind: 'openapi',
        sourceUrl: httpUrl(config.sourceUrl),
        path: config.path,
        method: config.method,
        serverUrl: serverAddress(servers(saved, config.path, config.method)[0]!, config.sourceUrl),
        document: saved,
        auth: [],
      }
    } else selected = selectOperation(document, config.sourceUrl, config.path, config.method)
  }
  const defaultAuth = () => {
    const defaultSelection = securityOptions(current!.document, current!.path, current!.method).find((option) => option.auth != null)?.auth
    if (defaultSelection == null) throw new AuthoringOpenApiAuthenticationError(current!)
    return defaultSelection
  }
  const auth =
    authentication == null
      ? !changed && explicit.authentication
        ? defaultAuth()
        : selected.auth
      : !changed && dequal(authentication, authenticationView(current))
        ? current.auth
        : prepareAuthentication(selected, authentication)
  const serverUrl =
    !changed && explicit.serverUrl && config.serverUrl == null
      ? serverAddress(servers(current.document, current.path, current.method)[0]!, current.sourceUrl)
      : changed && current != null && !explicit.serverUrl
        ? selected.serverUrl
        : (config.serverUrl ?? selected.serverUrl)
  const executor = { ...selected, auth, serverUrl }
  if (previous != null && !changed && dequal(auth, current.auth)) return { ...previous, name, executor }
  return openApiTask(executor, name)
}
