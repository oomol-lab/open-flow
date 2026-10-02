import type { JsonValue } from '../../../flow/common/change.ts'

import { isJsonObject } from '../../../base/common/json.ts'
import { PermanentIntegrationError } from '../../common/integration.ts'
import { feishuResourceKind } from './config.ts'

export interface FeishuSubscription {
  readonly key: string
  readonly config: Readonly<Record<string, JsonValue>>
}
export function feishuSubscriptions(config: Readonly<Record<string, JsonValue>>, provider: string): readonly FeishuSubscription[] {
  if (config.resource == null) return []
  if (!isJsonObject(config.resource)) throw new PermanentIntegrationError('Invalid Feishu resource.')
  const { kind, id, documentType } = config.resource
  if (typeof id != 'string' || id.length == 0 || kind != feishuResourceKind(config.eventTypes as string[]))
    throw new PermanentIntegrationError('Invalid resource subscription.')
  if (kind == 'document') {
    if (typeof documentType != 'string' || !['doc', 'docx', 'sheet', 'bitable', 'file', 'folder', 'slides'].includes(documentType))
      throw new PermanentIntegrationError('A supported document type is required.')
    return (config.eventTypes as string[]).map((eventType) => ({
      key: JSON.stringify(['document', documentType, id, eventType]),
      config: { ...config, eventTypes: [eventType] },
    }))
  }
  if (kind == 'calendar' || (kind == 'approval' && provider == 'feishu_app_bot')) return [{ key: JSON.stringify([kind, id]), config }]
  throw new PermanentIntegrationError('Unsupported Feishu resource subscription.')
}
