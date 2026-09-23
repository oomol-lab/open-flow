import type { ComponentProps } from 'react'
import type { InputPort } from '../api.ts'

import { SourceValueEditor } from './sourceValueEditor.tsx'

/** Adapts a node port to the shared source/literal field composition. */
export function NodeInputValue({
  definition,
  label,
  ...props
}: Omit<ComponentProps<typeof SourceValueEditor>, 'schema' | 'label' | 'nullable' | 'description'> & { definition: InputPort; label?: string }) {
  return (
    <SourceValueEditor
      {...props}
      schema={definition.jsonSchema}
      label={label ?? definition.handle}
      nullable={definition.nullable}
      description={definition.description}
    />
  )
}
