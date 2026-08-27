import type { AddEventListener } from '@wopjs/event'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { LocaleTextStore } from '../../../../localization/common/localization.ts'
import type { HandleSchemaOverridesItem, OutputHandleDef } from '../../../../schema/index.ts'
import type { WidgetContextConfig as SchemaWidgetContextConfig } from '../schemaEditor/widgetContext.ts'
import type { FieldPathKey } from './fieldPath.ts'

import { event, send } from '@wopjs/event'
import { isNumber } from 'radash'
import { attachSetter, derive } from 'value-enhancer'
import { setPartial, toPlainObject } from '../../base/trivial.ts'
import { FieldPath } from './fieldPath.ts'

/** Author can edit schema and value, user can edit value, and guest is read-only. */
export type Role = 'author' | 'user' | 'guest'

export type InOut = 'in' | 'out'

export interface OverrideSchema extends Omit<HandleSchemaOverridesItem, 'path'> {
  path: FieldPath
}

export interface WidgetContextConfig {
  readonly role: Role
  readonly inout: InOut
  /** If not set, will derive from `inout`. */
  readonly handlePosition?: InOut
  /** Set `false` to disable `any`, `anyOf`, `allOf`, `oneOf`, and `binary` types. */
  readonly enableAny?: boolean
  /** Enable schema description editor. */
  readonly enableSchemaDesc?: boolean
  /** This handle is from `additionalInputHandleDefs`. */
  readonly additional?: boolean
  /** The handle def is restricted when `restrict` is an object. */
  readonly restrict?: ReadonlyVal<boolean | OutputHandleDef | undefined>
  /** All translations. */
  readonly userLocales?: LocaleTextStore
}

export class WidgetContext implements SchemaWidgetContextConfig {
  public readonly role: Role
  public readonly inout: InOut
  public readonly handlePosition?: InOut
  public readonly enableAny: boolean
  public readonly enableSchemaDesc: boolean
  public readonly additional: boolean
  public readonly userLocales?: LocaleTextStore

  public readonly onRequestOpenSchemaEditor: AddEventListener<void> = /*#__PURE__*/ event()
  public readonly restrict$: ReadonlyVal<OutputHandleDef | undefined> | undefined

  public constructor(
    config: WidgetContextConfig,
    public readonly schema$: Val<unknown>,
    public readonly schemaOverrides$: Val<OverrideSchema[] | undefined>,
    public readonly defaultValue$: ReadonlyVal<unknown>,
    public readonly collapsed$: Val<Record<FieldPathKey, boolean> | undefined>,
    public readonly height$: Val<Record<FieldPathKey, number> | undefined>,
    public readonly createSchemaEditor: (dom: HTMLDivElement, schema$: Val<string> | ReadonlyVal<string>) => (() => void) | void,
  ) {
    this.role = config.role
    this.inout = config.inout
    this.handlePosition = config.handlePosition
    this.enableAny = config.enableAny ?? true
    this.additional = config.additional ?? false
    this.enableSchemaDesc = this.additional && this.inout === 'out'
    this.userLocales = config.userLocales
    this.restrict$ = config.restrict && derive(config.restrict, (v) => toPlainObject(v) as OutputHandleDef | undefined)
  }

  public get canEditSchema(): boolean {
    return this.role === 'author'
  }

  public get canEditValue(): boolean {
    return this.role === 'author' || this.role === 'user'
  }

  public get canViewSchema(): boolean {
    return true
  }

  public requestOpenSchemaEditor(): void {
    send(this.onRequestOpenSchemaEditor)
  }

  /** Removes schema overrides below `path`, excluding `path` itself. */
  public coalesceSchemaOverrideItems(path: FieldPath): void {
    const overrides = this.schemaOverrides$.value
    if (overrides) {
      const result = overrides.filter((item) => !item.path.isInside(path))
      if (result.length < overrides.length) {
        this.schemaOverrides$.set(result)
      }
    }
  }

  /** Removes collapsed state for `path` and all its descendants. */
  public coalesceCollapsed(path: FieldPath): void {
    const collapsed = this.collapsed$.value
    if (collapsed) {
      const result: Record<FieldPathKey, boolean> = {}
      for (const key in collapsed) {
        const candidate = FieldPath.fromKey(key)
        if (candidate.equals(path) || candidate.isInside(path)) continue
        result[key] = collapsed[key]
      }
      if (Object.keys(result).length < Object.keys(collapsed).length) {
        this.collapsed$.set(result)
      }
    }
  }

  public addSchemaOverrideItem(newItem: OverrideSchema, index?: number): void {
    if (this.schemaOverrides$.value?.some((item) => item.path.key === newItem.path.key)) {
      console.error(new Error('Duplicated schema override item'), newItem)
      return
    }
    if (!this.schemaOverrides$.value) {
      this.schemaOverrides$.set([newItem])
      return
    }
    const overrides = this.schemaOverrides$.value
    let insertAt = -1
    if (isNumber(index)) {
      let count = 0
      for (let i = 0; i < overrides.length; i++) {
        if (overrides[i].path.length === newItem.path.length) {
          count++
          if (count >= index) {
            insertAt = index === 0 ? i : i + 1
            break
          }
        }
      }
    }
    if (insertAt < 0) insertAt = overrides.length
    this.schemaOverrides$.set(overrides.toSpliced(insertAt, 0, newItem))
  }

  public removeSchemaOverrideItem(path: FieldPath): void {
    let overrides = this.schemaOverrides$.value
    if (overrides) {
      const at = overrides.findIndex((item) => path.equals(item.path))
      if (at >= 0) {
        overrides = overrides.toSpliced(at, 1)
        // Removing an array item shifts the paths of all following overrides down by one.
        const index = path.last()
        if (typeof index === 'number') {
          const dir = path.parent()
          overrides = overrides.map((item) => {
            if (dir.matchChild(item.path)) {
              const current = item.path.last() as number
              if (current > index) {
                return {
                  ...item,
                  path: dir.append(current - 1),
                }
              }
            }
            return item
          })
        }
        this.schemaOverrides$.set(overrides)
      }
    }
  }

  // Duplicating an array item copies its override and shifts all following overrides up by one.
  public duplicateSchemaOverrideItem(path: FieldPath): void {
    let overrides = this.schemaOverrides$.value
    // The final path segment must be an array index.
    if (overrides && typeof path.last() === 'number') {
      const item = overrides.find((override) => path.equals(override.path))
      if (item) {
        const dir = path.parent()
        const index = path.last() as number
        overrides = overrides.map((override) => {
          if (dir.matchChild(override.path)) {
            const current = override.path.last() as number
            if (current > index) {
              return {
                ...override,
                path: dir.append(current + 1),
              }
            }
          }
          return override
        })
        overrides.push({
          ...item,
          path: dir.append(index + 1),
        })
        this.schemaOverrides$.set(overrides)
      }
    }
  }

  public deriveSchemaOverrideItem$(path: FieldPath): Val<OverrideSchema | undefined> {
    return attachSetter(
      derive(this.schemaOverrides$, (overrides) => overrides?.find((item) => path.equals(item.path))),
      (item) => {
        const overrides = this.schemaOverrides$.value
        if (!overrides) {
          if (item) {
            this.schemaOverrides$.set([item])
          }
          return
        }

        const index = overrides.findIndex((override) => path.equals(override.path))
        let result: OverrideSchema[] | undefined

        if (!item) {
          if (index >= 0) result = overrides.toSpliced(index, 1)
          else return
        } else if (index >= 0) {
          result = overrides.toSpliced(index, 1, item)
        } else {
          result = [...overrides, item]
        }

        this.schemaOverrides$.set(result.filter((override) => !override.path.isInside(path)))
      },
    )
  }

  public deriveCollapsed$(path: FieldPath): Val<boolean> {
    return attachSetter(
      derive(this.collapsed$, (collapsed) => collapsed?.[path.key] ?? false),
      setPartial(this.collapsed$, path.key),
    )
  }

  public deriveHeight$(path: FieldPath): Val<number | undefined> {
    return attachSetter(
      derive(this.height$, (height) => height?.[path.key]),
      setPartial(this.height$, path.key),
    )
  }
}
