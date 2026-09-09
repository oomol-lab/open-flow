import type { JsonSchema } from '../jsonSchema/types.ts'
import type { HandleKind } from './handle.tsx'

import { filterString } from '../base/trivial.ts'
import { ContentMediaType } from '../jsonSchema/preset.ts'

export const DEFAULT_HANDLE_KIND: HandleKind = 'primitive'

export function getHandleKind(schema: unknown): HandleKind {
  const t = filterString((schema as JsonSchema)?.contentMediaType)
  if (t === ContentMediaType.binary) return 'bin'
  // if ((schema as JsonSchema)?.type === "string") return "string";
  return DEFAULT_HANDLE_KIND
}
