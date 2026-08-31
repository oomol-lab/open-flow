import type { ControlErrorCode } from '@oomol-lab/open-flow/control-api'

import { controlErrorMetadata } from '@oomol-lab/open-flow/control-api'

export const serverErrorCode = {
  authenticationInvalid: 'authentication.invalid',
  configurationConflict: 'configuration.conflict',
  configurationEnvironmentManaged: 'configuration.environment-managed',
  connectorConnectionRequired: 'connector.connection-required',
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
  [serverErrorCode.authenticationInvalid]: { status: 401 },
  [serverErrorCode.configurationConflict]: { status: 409 },
  [serverErrorCode.configurationEnvironmentManaged]: { status: 409 },
  [serverErrorCode.connectorConnectionRequired]: { status: 409 },
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

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
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
    | 'trigger-payload-invalid'

  constructor(code: AcceptanceError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'AcceptanceError'
  }
}
