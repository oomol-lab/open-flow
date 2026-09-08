import type { Val } from 'value-enhancer'
import type { InputHandleDef, OutputHandleDef } from '../../../../../schema/index.ts'
import type { FieldPathKey } from '../../../stores/nodeHandle/fieldPath.ts'
import type { InOut, Role } from '../../../stores/nodeHandle/widgetContext.ts'

import { useEffect, useMemo } from 'react'
import { attachSetter, derive, val } from 'value-enhancer'
import { asTrue, equalConfig, noop, toPlainObject, updatePartial } from '../../../base/trivial.ts'
import { HandleWithActions } from '../../../components/handleNoActions.tsx'
import { UserLocalesProvider } from '../../../components/userLocales.tsx'
import { sizeOfSchema } from '../../../jsonSchema/preset.ts'
import { LowCodeEditor } from '../../../jsonSchema/schemaEditor.tsx'
import { SchemaRowStore } from '../../../stores/schemaEditor/schemaRow.store.ts'
import { WidgetContext } from '../../../stores/schemaEditor/widgetContext.ts'

export interface InlineSchemaEditorProps {
  readonly level: string
  readonly def$: Val<boolean | InputHandleDef | undefined> | Val<boolean | OutputHandleDef | undefined>
  readonly role: Role
  readonly inout: InOut
}

/** Edits restricted additional input and output definitions. */
export function InlineSchemaEditor(props: InlineSchemaEditorProps): React.ReactElement {
  const store = useMemo(() => createSchemaRowStore(props.def$, props.role, props.inout), [props.def$, props.role, props.inout])
  useEffect(() => () => store.dispose(), [])

  return (
    <HandleWithActions>
      <UserLocalesProvider value={void 0}>
        <LowCodeEditor store={store} level={props.level} nameFactor={12} valueFactor={13} hideHandle />
      </UserLocalesProvider>
    </HandleWithActions>
  )
}

function createSchemaRowStore(
  def$_: Val<boolean | InputHandleDef | undefined> | Val<boolean | OutputHandleDef | undefined>,
  role: Role,
  inout: InOut,
): SchemaRowStore {
  const def$: Val<InputHandleDef | OutputHandleDef | undefined> = attachSetter(derive(def$_, toInputHandleDef), def$_.set)
  const description$ = attachSetter(
    derive(def$, (d) => d?.description),
    updatePartial(def$, 'description'),
  )
  const schema$ = attachSetter(
    derive(def$, (d) => d?.json_schema, equalConfig),
    updatePartial(def$, 'json_schema'),
  )
  const nullable$ = attachSetter(
    derive(def$, (d) => asTrue(d?.nullable)),
    updatePartial(def$, 'nullable'),
  )
  const kind$ = attachSetter(
    derive(def$, (d) => d?.kind),
    updatePartial(def$, 'kind'),
  )
  const context = new WidgetContext(
    { role, inout, enableAny: false },
    schema$,
    val<Record<FieldPathKey, boolean> | undefined>(sizeOfSchema(schema$.value) <= 3 ? { '[]': true } : void 0),
    noop, // Inline schema editing does not open the full schema source editor.
  )
  const store = new SchemaRowStore('[internal]', description$, description$, nullable$, kind$, context)
  store.dispose.add([def$, description$, schema$, nullable$, kind$])
  return store
}

function toInputHandleDef(def: boolean | InputHandleDef | undefined): InputHandleDef | undefined
function toInputHandleDef(def: boolean | OutputHandleDef | undefined): OutputHandleDef | undefined
function toInputHandleDef(def: boolean | OutputHandleDef | undefined): OutputHandleDef | undefined {
  return toPlainObject(def) as OutputHandleDef | undefined
}
