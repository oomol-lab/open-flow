import type { ConnectorExecutor, Executor, JavascriptExecutor, LlmExecutor } from '../../../../../schema/index.ts'

import { isString } from '@wopjs/cast'
import { None, Option } from '@wopjs/tsur'
import { parseString } from '../../../../../base/common/parse.ts'
import { isUnknownRecord } from '../../../../../base/common/type.ts'

export function parseTaskBlockExecutor(data: unknown): Option<Executor> {
  return Option.from(data, (value): value is { name: string; options: unknown } => isUnknownRecord(value) && isString(value.name)).andThen(
    (executor): Option<Executor> => {
      if (executor.name === 'javascript') {
        return parseJavascriptExecutorOptions(executor.options).map(
          (options): JavascriptExecutor => ({
            name: 'javascript',
            options,
          }),
        )
      } else if (executor.name === 'connector') {
        return parseConnectorExecutorOptions(executor.options).map(
          (options): ConnectorExecutor => ({
            name: 'connector',
            options,
          }),
        )
      } else if (executor.name === 'llm') {
        return parseLlmExecutorOptions(executor.options).map(
          (options): LlmExecutor => ({
            name: 'llm',
            options,
          }),
        )
      } else {
        return None
      }
    },
  )
}

function parseLlmExecutorOptions(options: unknown): Option<LlmExecutor['options']> {
  return Option.from(options, isUnknownRecord).andThen((record) =>
    Option.from(record.mode, (mode): mode is LlmExecutor['options']['mode'] => mode === 'chat' || mode === 'json').map((mode) => ({ mode })),
  )
}

function parseConnectorExecutorOptions(options: unknown): Option<ConnectorExecutor['options']> {
  return Option.from(options, isUnknownRecord).andThen((record) =>
    Option.from(record.action, (action): action is string => isString(action) && action.length > 0).andThen((action) => {
      if (record.connection == null) return Option.from({ action })
      return Option.from(record.connection, (connection): connection is string => isString(connection) && connection.length > 0).map((connection) => ({
        action,
        connection,
      }))
    }),
  )
}

function parseJavascriptExecutorOptions(options: unknown): Option<JavascriptExecutor['options']> {
  return Option.from(options, isUnknownRecord).andThen((record) =>
    parseString(record.entry).andThen((entry) =>
      entry.length == 0
        ? None
        : Option.from({
            entry,
            function: parseString(record.function).unwrapOr(),
          }),
    ),
  )
}
