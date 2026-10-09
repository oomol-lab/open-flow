import type { ControlErrorCode } from '@oomol-lab/open-flow/control-api'

import { controlErrorMetadata } from '@oomol-lab/open-flow/control-api'

export const serverErrorCode = {
  authorizationDenied: 'authorization.denied',
  userConflict: 'user.conflict',
  userNotFound: 'user.not-found',
  authenticationInvalid: 'authentication.invalid',
  configurationConflict: 'configuration.conflict',
  configurationEnvironmentManaged: 'configuration.environment-managed',
  configurationLoginExpired: 'configuration.login-expired',
  configurationLoginUnavailable: 'configuration.login-unavailable',
  connectorConnectionRequired: 'connector.connection-required',
  connectorInputInvalid: 'connector.input-invalid',
  connectorIndeterminate: 'connector.indeterminate',
  internal: 'internal',
  operatorAlreadyConfigured: 'operator.already-configured',
  operatorInvalid: 'operator.invalid',
  operatorNotConfigured: 'operator.not-configured',
  flowRevisionStorageConflict: 'flow.revision-storage-conflict',
  requestInvalid: 'request.invalid',
} as const

type ServerErrorCode = (typeof serverErrorCode)[keyof typeof serverErrorCode]
type ErrorCode = ControlErrorCode | ServerErrorCode

const errorMetadata = {
  ...controlErrorMetadata,
  [serverErrorCode.authorizationDenied]: { status: 403 },
  [serverErrorCode.userConflict]: { status: 409 },
  [serverErrorCode.userNotFound]: { status: 404 },
  [serverErrorCode.authenticationInvalid]: { status: 401 },
  [serverErrorCode.configurationConflict]: { status: 409 },
  [serverErrorCode.configurationEnvironmentManaged]: { status: 409 },
  [serverErrorCode.configurationLoginExpired]: { status: 410 },
  [serverErrorCode.configurationLoginUnavailable]: { status: 502 },
  [serverErrorCode.connectorConnectionRequired]: { status: 409 },
  [serverErrorCode.connectorInputInvalid]: { status: 400 },
  [serverErrorCode.connectorIndeterminate]: { status: 502 },
  [serverErrorCode.internal]: { status: 500 },
  [serverErrorCode.operatorAlreadyConfigured]: { status: 409 },
  [serverErrorCode.operatorInvalid]: { status: 400 },
  [serverErrorCode.operatorNotConfigured]: { status: 503 },
  [serverErrorCode.flowRevisionStorageConflict]: { status: 409 },
  [serverErrorCode.requestInvalid]: { status: 400 },
} as const satisfies Record<ErrorCode, { readonly status: number }>

export class ControlError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, options?: ErrorOptions & { details?: Record<string, unknown> }) {
    super(message, options)
    this.code = code
    this.details = options?.details
    this.name = 'ControlError'
    this.status = errorMetadata[code].status
  }
}

export class AcceptanceError extends Error {
  readonly code:
    | 'engine-unsupported'
    | 'flow-inputs-invalid'
    | 'flow-invalid'
    | 'flow-not-found'
    | 'publication-live-conflict'
    | 'revision-conflict'
    | 'revision-invalid'
    | 'trigger-invalid'
    | 'trigger-outputs-invalid'

  constructor(code: AcceptanceError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'AcceptanceError'
  }
}
