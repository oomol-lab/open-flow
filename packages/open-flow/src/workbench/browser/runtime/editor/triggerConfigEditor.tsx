import type { ReactNode } from 'react'
import type { Group, InputPort, JsonValue } from '../api.ts'

import { triggerConfigValue } from '../../../../trigger/common/config.ts'
import { NodeInputs } from './nodeInputs.tsx'
import { TriggerConfigTitle } from './triggerConfigTitle.tsx'

const fixedVariables = { enabled: false, loaded: true, loading: false, names: [], onOpen() {} }
const noVariable = () => {}

export function TriggerConfigEditor({
  inputs,
  config,
  disabled,
  onChange,
  renderEditor,
}: {
  readonly inputs: readonly (InputPort | Group)[]
  readonly config: Readonly<Record<string, JsonValue>>
  readonly disabled: boolean
  readonly onChange: (name: string, value: JsonValue | undefined) => void
  readonly renderEditor?: (input: InputPort) => ReactNode
}) {
  if (inputs.length === 0) return null
  return (
    <div data-inspector-section="trigger">
      <NodeInputs
        title={<TriggerConfigTitle />}
        titleIcon={null}
        allowAddGroup={false}
        entries={inputs.map((input) =>
          'group' in input
            ? input
            : {
                definition: input,
                connected: false,
                fixed: true,
                value: triggerConfigValue(input, config),
                editor: renderEditor?.(input),
              },
        )}
        variables={fixedVariables}
        disabled={disabled}
        onValue={onChange}
        onVariable={noVariable}
      />
    </div>
  )
}
