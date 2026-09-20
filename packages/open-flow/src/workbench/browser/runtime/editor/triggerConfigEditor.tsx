import type { ReactNode } from 'react'
import type { InputValues } from '../../../../flow/common/change.ts'
import type { Group, InputPort, JsonValue } from '../api.ts'

import { useTranslate } from 'val-i18n-react'
import { triggerConfigValue } from '../../../../trigger/common/config.ts'
import { NodeInputs } from './nodeInputs.tsx'

const fixedVariables = { enabled: false, loaded: true, loading: false, names: [], onOpen() {} }
const noVariable = () => {}

export function TriggerConfigEditor({
  inputs,
  config,
  disabled,
  onChange,
  onReset,
  onResetValue,
  renderEditor,
}: {
  readonly onReset?: () => void | Promise<boolean>
  readonly onResetValue?: (name: string) => void
  readonly inputs: readonly (InputPort | Group)[]
  readonly config: InputValues
  readonly disabled: boolean
  readonly onChange: (name: string, value: JsonValue | undefined) => void
  readonly renderEditor?: (input: InputPort) => ReactNode
}) {
  const t = useTranslate()
  if (inputs.length === 0) return null
  return (
    <div data-inspector-section="trigger">
      <NodeInputs
        title={t('triggerConfig.configuration')}
        titleIcon="configuration"
        allowAddGroup={false}
        entries={inputs.map((input) =>
          'group' in input
            ? input
            : {
                definition: input,
                connected: false,
                fixed: true,
                value: triggerConfigValue(input, config),
                onReset:
                  input.value !== undefined && Object.hasOwn(config, input.handle) && onResetValue != null ? () => onResetValue(input.handle) : undefined,
                editor: renderEditor?.(input),
              },
        )}
        variables={fixedVariables}
        disabled={disabled}
        onValue={onChange}
        onReset={onReset}
        onVariable={noVariable}
      />
    </div>
  )
}
