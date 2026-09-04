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
  [controlErrorCode.flowInvalid]: 'notice.error.flowInvalid',
  [controlErrorCode.flowNotFound]: 'notice.error.flowNotFound',
  [controlErrorCode.flowBusy]: 'notice.error.flowBusy',
  [controlErrorCode.flowConflict]: 'notice.error.flowConflict',
  [controlErrorCode.flowPresentationConflict]: 'notice.error.flowPresentationConflict',
  [controlErrorCode.flowRevisionConflict]: 'notice.error.flowRevisionConflict',
  [controlErrorCode.liveConflict]: 'notice.error.liveConflict',
  [controlErrorCode.liveNotFound]: 'notice.error.liveNotFound',
  [controlErrorCode.pageInvalidCursor]: 'notice.error.pageInvalidCursor',
  [controlErrorCode.publicationConflict]: 'notice.error.publicationConflict',
  [controlErrorCode.publicationNotFound]: 'notice.error.publicationNotFound',
  [controlErrorCode.publicationUnsupported]: 'notice.error.publicationUnsupported',
  [controlErrorCode.publishOperationNotFound]: 'notice.error.publishOperationNotFound',
  [controlErrorCode.routeNotFound]: 'notice.error.routeNotFound',
  [controlErrorCode.runConflict]: 'notice.error.runConflict',
  [controlErrorCode.runEventsExpired]: 'notice.error.runEventsExpired',
  [controlErrorCode.runInvalid]: 'notice.error.runInvalid',
  [controlErrorCode.runNotFound]: 'notice.error.runNotFound',
  [controlErrorCode.runNotTerminal]: 'notice.error.runNotTerminal',
  [controlErrorCode.runOverloaded]: 'notice.error.runOverloaded',
  [controlErrorCode.runWaitNotFound]: 'notice.error.runWaitNotFound',
  [controlErrorCode.triggerKeyInvalid]: 'notice.error.triggerKeyInvalid',
  [controlErrorCode.triggerKeyNotFound]: 'notice.error.triggerKeyNotFound',
  [controlErrorCode.triggerNotFound]: 'notice.error.triggerNotFound',
  [controlErrorCode.variableInvalid]: 'notice.error.variableInvalid',
  [controlErrorCode.variableLimitReached]: 'notice.error.variableLimitReached',
  [controlErrorCode.variableNotFound]: 'notice.error.variableNotFound',
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
  if (error instanceof TypeError) return { kind: 'error', message: t('notice.networkFailed') }
  if (error instanceof Error) return { kind: 'error', message: error.message }
  return { kind: 'error', message: t('notice.requestFailed') }
}
