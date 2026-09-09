import type { HandleKind } from './handle.tsx'

import { ContentMediaType } from '../../../form/common/schemaWidget.ts'
import { objectValue } from '../../../form/common/value.ts'

export const DEFAULT_HANDLE_KIND: HandleKind = 'primitive'

export function getHandleKind(schema: unknown): HandleKind {
  return objectValue(schema)?.contentMediaType === ContentMediaType.binary ? 'bin' : DEFAULT_HANDLE_KIND
}
