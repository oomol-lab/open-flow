import type { JsonValue } from '../../types/index.ts'

interface ConnectorActionContract {
  readonly inputConstraints?: readonly {
    readonly handle: string
    readonly jsonSchema: JsonValue
    readonly code: string
    readonly message: string
  }[]
  readonly pendingMessageInput?: string
}

/** These rules also apply to existing Revision snapshots without a catalog lookup. */
export const connectorActionContracts: Readonly<Record<string, ConnectorActionContract | undefined>> = {
  'leina.send_notification': {
    inputConstraints: [
      {
        handle: 'leinaId',
        jsonSchema: { type: 'string', pattern: '\\S' },
        code: 'leina.robot-required',
        message: 'Select a Leina robot or bind its identifier to an input source.',
      },
    ],
    pendingMessageInput: 'message',
  },
}
