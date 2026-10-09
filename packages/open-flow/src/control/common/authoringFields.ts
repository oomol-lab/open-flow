import type { InputPort, Group, JsonValue } from '../../flow/common/change.ts'

import { dequal } from 'dequal/lite'
const record = (value: unknown): Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
/** Business field contracts, independent of storage handles and presentation groups. */
export function fieldsView(ports: readonly (InputPort | Group)[]) {
  return Object.fromEntries(
    ports.flatMap((port) =>
      'handle' in port
        ? [
            [
              port.handle,
              {
                schema: port.jsonSchema,
                nullable: port.nullable,
                ...(port.description == null ? {} : { description: port.description }),
                ...(Object.hasOwn(port, 'value') ? { default: port.value } : {}),
              },
            ],
          ]
        : [],
    ),
  )
}
export function fieldsToPorts(fields: unknown, previous: readonly (InputPort | Group)[]): readonly (InputPort | Group)[] {
  const remaining = new Map(Object.entries(record(fields)))
  function port(handle: string, value: unknown): InputPort {
    const field = record(value)
    return {
      handle,
      jsonSchema: (Object.hasOwn(field, 'schema') ? field.schema : {}) as JsonValue,
      nullable: (field.nullable ?? true) as boolean,
      ...(field.description == null ? {} : { description: String(field.description) }),
      ...(Object.hasOwn(field, 'default') ? { value: field.default as JsonValue } : {}),
    }
  }
  return [
    ...previous.flatMap<InputPort | Group>((old) => {
      if (!('handle' in old)) return [old]
      if (!remaining.has(old.handle)) return []
      const value = remaining.get(old.handle)
      remaining.delete(old.handle)
      return [dequal(fieldsView([old])[old.handle], value) ? old : port(old.handle, value)]
    }),
    ...Array.from(remaining, ([handle, value]) => port(handle, value)),
  ]
}
