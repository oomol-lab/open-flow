import type { TFunction } from 'val-i18n'
import type { ControlErrorCode } from '../../../../control/common/errors.ts'
import type { WorkbenchNotification } from '../contract.ts'

import { controlErrorCode } from '../../../../control/common/errors.ts'
import { ApiError } from '../api.ts'

export type Notice = WorkbenchNotification

export type SetNotice = (notice: Notice | undefined) => void

const errorKeys = {
  [controlErrorCode.authenticationRequired]: 'notice.error.authenticationRequired',
  [controlErrorCode.authorizationDenied]: 'notice.error.authorizationDenied',
  [controlErrorCode.bindingUnresolved]: 'notice.error.bindingUnresolved',
  [controlErrorCode.connectorActionNotFound]: 'notice.error.connectorActionNotFound',
  [controlErrorCode.connectorUnconfigured]: 'notice.connectorUnconfigured',
  [controlErrorCode.connectorUnavailable]: 'notice.error.connectorUnavailable',
  [controlErrorCode.engineUnavailable]: 'notice.error.engineUnavailable',
  [controlErrorCode.engineUnsupported]: 'notice.error.engineUnsupported',
  [controlErrorCode.flowInvalid]: 'notice.error.invalidRequest',
  [controlErrorCode.flowNotFound]: 'notice.error.notFound',
  [controlErrorCode.flowBusy]: 'notice.error.resourceBusy',
  [controlErrorCode.flowConflict]: 'notice.error.conflict',
  [controlErrorCode.flowPresentationConflict]: 'notice.error.conflict',
  [controlErrorCode.flowRevisionConflict]: 'notice.error.conflict',
  [controlErrorCode.liveConflict]: 'notice.error.conflict',
  [controlErrorCode.liveNotFound]: 'notice.error.notFound',
  [controlErrorCode.pageInvalidCursor]: 'notice.error.invalidRequest',
  [controlErrorCode.publicationConflict]: 'notice.error.conflict',
  [controlErrorCode.publicationNotFound]: 'notice.error.notFound',
  [controlErrorCode.publicationUnsupported]: 'notice.error.publicationUnsupported',
  [controlErrorCode.publishOperationNotFound]: 'notice.error.notFound',
  [controlErrorCode.routeNotFound]: 'notice.error.notFound',
  [controlErrorCode.runConflict]: 'notice.error.conflict',
  [controlErrorCode.runEventsExpired]: 'notice.error.runEventsExpired',
  [controlErrorCode.runInvalid]: 'notice.error.invalidRequest',
  [controlErrorCode.runNotFound]: 'notice.error.notFound',
  [controlErrorCode.runNotTerminal]: 'notice.error.runNotTerminal',
  [controlErrorCode.runOverloaded]: 'notice.error.runOverloaded',
  [controlErrorCode.runWaitNotFound]: 'notice.error.notFound',
  [controlErrorCode.triggerKeyInvalid]: 'notice.error.invalidRequest',
  [controlErrorCode.triggerKeyNotFound]: 'notice.error.notFound',
  [controlErrorCode.triggerNotFound]: 'notice.error.notFound',
  [controlErrorCode.variableInvalid]: 'notice.error.invalidRequest',
  [controlErrorCode.variableLimitReached]: 'notice.error.variableLimitReached',
  [controlErrorCode.variableNotFound]: 'notice.error.notFound',
  'connector.connection-required': 'notice.error.connectorConnectionRequired',
  'request.failed': 'notice.requestFailed',
  'response.invalid': 'notice.error.responseInvalid',
} as const satisfies Readonly<Record<ControlErrorCode | 'connector.connection-required' | 'request.failed' | 'response.invalid', string>>

export function errorNotice(error: unknown, t: TFunction): Notice {
  if (error instanceof ApiError) {
    const key = (errorKeys as Readonly<Record<string, string>>)[error.code]
    if (key != null) return { kind: 'error', message: t(key) }
    return { kind: 'error', message: `${error.message} (${error.code})` }
  }
  if (error instanceof TypeError) return { kind: 'error', message: t('notice.requestFailed') }
  if (error instanceof Error) return { kind: 'error', message: error.message }
  return { kind: 'error', message: t('notice.requestFailed') }
}
