import type { ReadonlyVal, Val } from 'value-enhancer'
import type { FieldPath } from './fieldPath.ts'
import type { OverrideSchema, WidgetContext } from './widgetContext.ts'

import { disposableOne } from '@wopjs/disposable'
import { combine, derive } from 'value-enhancer'
import { typeOfSchema } from '../../jsonSchema/preset.ts'
import { AnyOfWidgetStore } from './anyOfWidget.store.ts'
import { ArrayWidgetStore } from './arrayWidget.store.ts'
import { ObjectWidgetStore } from './objectWidget.store.ts'
import { SimpleWidgetStore } from './simpleWidget.store.ts'

export type WidgetStore = SimpleWidgetStore

export const reconcileWidget$ = (
  path: FieldPath,
  schema$: Val<unknown>,
  context: WidgetContext,
  value$: Val<unknown> | undefined,
  overrideSchema$: Val<OverrideSchema | undefined>,
): ReadonlyVal<WidgetStore> => {
  const disposer = disposableOne()
  const widgetType$ = combine([schema$, overrideSchema$], ([schema, overrideSchema]) => {
    const type = typeOfSchema(schema)
    const overrideType = typeOfSchema(overrideSchema?.schema)
    return type === 'any' ? overrideType : type
  })
  const derived$ = derive(widgetType$, (widgetType) => {
    let widgetStore: WidgetStore
    if (widgetType === 'anyOf') {
      widgetStore = new AnyOfWidgetStore(path, schema$, context, value$, overrideSchema$)
    } else if (widgetType === 'object') {
      widgetStore = new ObjectWidgetStore(path, schema$, context, value$, overrideSchema$)
    } else if (widgetType === 'array') {
      widgetStore = new ArrayWidgetStore(path, schema$, context, value$, overrideSchema$)
    } else {
      widgetStore = new SimpleWidgetStore(path, schema$, context, value$, overrideSchema$)
    }
    return disposer.set(widgetStore)
  })
  const derived$Dispose = derived$.dispose
  derived$.dispose = () => {
    derived$Dispose.call(derived$)
    widgetType$.dispose()
    disposer.dispose()
  }
  return derived$
}
