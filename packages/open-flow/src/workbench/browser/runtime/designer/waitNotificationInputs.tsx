import type { ReactElement } from 'react'
import type { FlowRunInputDefinition } from '../../flowRunInputEditorStore.ts'
import type { JsonValue } from '../api.ts'
import type { WorkbenchTheme } from '../contract.ts'

import { useEffect, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { val } from 'value-enhancer'
import { FlowRunInputEditor } from '../../flowRunInputEditor.tsx'
import { flowRunInputEditorState, FlowRunInputEditorStore } from '../../flowRunInputEditorStore.ts'

export function WaitNotificationInputs({
  definitions,
  language,
  onChange,
  onValidChange,
  showErrors,
  theme,
  values,
}: {
  readonly definitions: readonly FlowRunInputDefinition[]
  readonly language: string
  readonly onChange: (values: Readonly<Record<string, JsonValue>>) => void
  readonly onValidChange: (valid: boolean) => void
  readonly showErrors: boolean
  readonly theme: WorkbenchTheme
  readonly values: Readonly<Record<string, JsonValue>>
}): ReactElement {
  const [language$] = useState(() => val(language))
  const [store] = useState(() => {
    const created = new FlowRunInputEditorStore(definitions, language$)
    created.replaceValues(values)
    return created
  })
  const inputValues = useVal(flowRunInputEditorState(store).inputs.inputValues$)
  const valid = useVal(store.valid$)

  useEffect(() => language$.set(language), [language, language$])
  useEffect(() => onChange(store.values() as Readonly<Record<string, JsonValue>>), [inputValues, onChange, store])
  useEffect(() => onValidChange(valid), [onValidChange, valid])
  useEffect(
    () => () => {
      store.dispose()
      language$.dispose()
    },
    [language$, store],
  )

  return <FlowRunInputEditor showErrors={showErrors} store={store} theme={theme} />
}
