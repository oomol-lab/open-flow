import type { HandleOutputFrom, HandleInputFrom, HandleFromNode } from '../../../../schema/index.ts'

import { Some, None, Option } from '@wopjs/tsur'
import { parseArray } from '../../../../base/common/parse.ts'
import { isUnknownRecord } from '../../../../base/common/type.ts'
import { parseHandleSchemaOverrides } from '../../schemaOverrides.ts'
import { parseHandleName, parseNodeId } from '../../utils.ts'

export function parseHandleOutputsFrom(data: unknown): Option<readonly HandleOutputFrom[]> {
  return parseArray(data, parseHandleOutputFrom)
}

function parseHandleOutputFrom(data: unknown): Option<HandleOutputFrom> {
  if (isUnknownRecord(data)) {
    const handle = parseHandleName(data.handle)
    if (handle.isSome()) {
      return Some({
        handle: handle.unwrap(),
        from_node: parseArray(data.from_node, parseHandleFromNode).unwrapOr(),
      })
    }
  }
  return None
}

export function parseHandleInputsFrom(data: unknown): Option<readonly HandleInputFrom[]> {
  return parseArray(data, parseHandleInputFrom)
}

function parseHandleInputFrom(data: unknown): Option<HandleInputFrom> {
  return Option.from(data, isUnknownRecord).andThen((record) =>
    parseHandleName(record.handle).map((handle) => ({
      handle,
      value: record.value,
      schema_overrides: parseHandleSchemaOverrides(record.schema_overrides),
      from_node: parseArray(record.from_node, parseHandleFromNode).unwrapOr(),
    })),
  )
}

function parseHandleFromNode(data: unknown): Option<HandleFromNode> {
  return Option.from(data, isUnknownRecord).andThen((record) =>
    parseNodeId(record.node_id).zipWith(parseHandleName(record.output_handle), (node_id, output_handle) => ({
      node_id,
      output_handle,
    })),
  )
}
