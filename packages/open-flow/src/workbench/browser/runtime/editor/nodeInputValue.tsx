import type { ComponentProps } from 'react'
import type { InputPort } from '../api.ts'

import { SourceValueEditor } from './sourceValueEditor.tsx'

/** Adapts a node port to the shared source/literal field composition. */
export function NodeInputValue({
  definition,
  ...props
}: Omit<ComponentProps<typeof SourceValueEditor>, 'schema' | 'label' | 'nullable' | 'description'> & { definition: InputPort }) {
  return (
    <SourceValueEditor
      {...props}
      schema={definition.jsonSchema}
      label={definition.handle}
      nullable={definition.nullable}
      description={definition.description}
    />
  )
}
