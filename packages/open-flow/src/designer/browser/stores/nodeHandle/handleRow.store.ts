import type { DisposableStore } from '@wopjs/disposable'
import type { ValidateFunction } from 'ajv'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { HandleName, OutputHandleDef } from '../../../../schema/index.ts'
import type { HandleKind } from '../../components/handle.tsx'
import type { ErrorMessage } from '../node/constants.ts'
import type { FieldPathKey } from './fieldPath.ts'
import type { WidgetStore } from './reconcileWidget.ts'
import type { OverrideSchema, WidgetContext } from './widgetContext.ts'

import { disposableStore } from '@wopjs/disposable'
import { attachSetter, combine, compute, derive, val } from 'value-enhancer'
import { asTrue } from '../../base/trivial.ts'
import { asPrimitiveType, getBaseSchema, inferPrimitiveType, isUndecidable, sizeOfSchema, typeOfSchema } from '../../jsonSchema/preset.ts'
import { ajv, compile, validate } from '../../validate/validator.ts'
import { SchemaRowStore } from '../schemaEditor/schemaRow.store.ts'
import { WidgetContext as SchemaWidgetContext } from '../schemaEditor/widgetContext.ts'
import { FieldPath } from './fieldPath.ts'
import { getHandleKind } from './handleKind.ts'
import { reconcileWidget$ } from './reconcileWidget.ts'

export type HandleError =
  | {
      readonly type: 'validationError'
      readonly message: ErrorMessage
    }
  | {
      readonly type: 'typeError'
      readonly message?: ErrorMessage
    }

export class HandleRowStore {
  public static is(value: unknown): value is HandleRowStore {
    return value instanceof HandleRowStore
  }

  public readonly dispose: DisposableStore = disposableStore()

  public readonly path: FieldPath
  public readonly name: HandleName
  public readonly value$?: Val<unknown>
  /** Blocks flow execution. */
  public readonly error$: Val<HandleError | undefined>
  public readonly reference$: ReadonlyVal<boolean>
  public readonly nullable$: Val<boolean>
  public readonly schema$: Val<unknown>
  /** A restriction makes `schema$`, `nullable$`, and `schemaKind$` read-only. */
  public readonly restrict$: ReadonlyVal<OutputHandleDef | undefined> | undefined
  public readonly description$: Val<string | undefined>
  public readonly displayDescription$: ReadonlyVal<string | undefined>
  public readonly widget$: ReadonlyVal<WidgetStore>
  public readonly context: WidgetContext

  public readonly lang$: ReadonlyVal<string>
  public readonly overrideSchema$: Val<OverrideSchema | undefined>
  public readonly showSettings$: Val<boolean>
  public readonly kind$: ReadonlyVal<HandleKind | undefined>
  public readonly schemaKind$: Val<string | undefined>

  public constructor(
    name: HandleName,
    description$: Val<string | undefined>,
    displayDescription$: ReadonlyVal<string | undefined>,
    lang$: ReadonlyVal<string>,
    schemaKind$: Val<string | undefined>,
    reference$: ReadonlyVal<boolean>,
    nullable$: Val<boolean>,
    showSettings$: Val<boolean>,
    context: WidgetContext,
    value$?: Val<unknown>,
  ) {
    this.name = name
    this.context = context
    this.path = FieldPath.get()
    this.value$ = value$
    this.schema$ = context.schema$
    this.restrict$ = context.restrict$
    if (this.restrict$) {
      this.dispose.add(this.restrict$)
    }
    this.schemaKind$ = schemaKind$
    this.description$ = description$
    this.displayDescription$ = displayDescription$
    this.reference$ = reference$
    this.nullable$ = nullable$
    this.showSettings$ = showSettings$

    if (this.restrict$) {
      const schema$ = this.schema$
      ;(this as { schema$: Val<unknown> }).schema$ = this.dispose.add(
        attachSetter(
          combine([schema$, this.restrict$], ([schema, restrict]) => (restrict ? restrict.json_schema : schema)),
          (schema: unknown) => this.restrict$?.value || schema$.set(schema),
        ),
      )

      const sourceNullable$ = this.nullable$
      ;(this as { nullable$: Val<boolean> }).nullable$ = this.dispose.add(
        attachSetter(
          combine([sourceNullable$, this.restrict$], ([nullable, restrict]) => (restrict ? asTrue(restrict.nullable) : nullable)),
          (nullable: boolean) => this.restrict$?.value || sourceNullable$.set(nullable),
        ),
      )

      const sourceSchemaKind$ = this.schemaKind$
      ;(this as { schemaKind$: Val<string | undefined> }).schemaKind$ = this.dispose.add(
        attachSetter(
          combine([sourceSchemaKind$, this.restrict$], ([kind, restrict]) => (restrict ? restrict.kind : kind)),
          (kind: string | undefined) => this.restrict$?.value || sourceSchemaKind$.set(kind),
        ),
      )
    }

    this.error$ = this.dispose.add(val())
    this.kind$ = this.dispose.add(derive(this.schema$, getHandleKind))
    this.lang$ = lang$
    this.overrideSchema$ = this.dispose.add(this.context.deriveSchemaOverrideItem$(this.path))

    this.widget$ = this.dispose.add(reconcileWidget$(this.path, this.schema$, context, this.value$, this.overrideSchema$))
    this.dispose.add(this.context.onRequestOpenSchemaEditor(() => this.showSettings$.set(!this.showSettings$.value)))

    // Validation
    if (this.value$) {
      let idleCallbackId: number | undefined
      this.dispose.add(
        this.schema$.subscribe((schema) => {
          if (idleCallbackId != null) {
            cancelIdleCallback(idleCallbackId)
          }
          idleCallbackId = requestIdleCallback(() => {
            idleCallbackId = undefined
            const [fn, error] = compile(schema)
            this.error$.set(
              error && {
                type: 'validationError',
                message: error + '',
              },
            )
            this.validateFn = fn
            this.validate(false)
          })
        }),
      )
      this.dispose.add(() => {
        if (idleCallbackId != null) {
          cancelIdleCallback(idleCallbackId)
        }
      })
      // Value and nullable changes intentionally select different validation paths.
      this.dispose.add(this.value$.subscribe(() => this.validate(true)))
      this.dispose.add(this.nullable$.subscribe(() => this.validate(false)))
      // An `any` schema can hide a mismatch between an override schema and its value.
      // Detect arrays here and select an array override so the handle editor remains stable.
      this.dispose.add(
        compute((get) => {
          if (
            isUndecidable(typeOfSchema(get(this.schema$))) &&
            isUndecidable(typeOfSchema(get(this.overrideSchema$)?.schema)) &&
            inferPrimitiveType(get(this.value$)) === 'array'
          ) {
            return true
          }
          return false
        }).subscribe((detected) => {
          if (detected) {
            this.overrideSchema$.set({
              ...this.overrideSchema$.value,
              path: this.path,
              schema: getBaseSchema('array'),
            })
          }
        }),
      )
    }
  }

  private validateFn?: ValidateFunction

  private schemaRowStoreCache?: SchemaRowStore
  public get schemaRowStore(): SchemaRowStore {
    if (this.schemaRowStoreCache) return this.schemaRowStoreCache
    const context = new SchemaWidgetContext(
      this.context,
      this.schema$,
      val<Record<FieldPathKey, boolean> | undefined>(sizeOfSchema(this.schema$.value) <= 3 ? { '[]': true } : void 0),
      this.context.createSchemaEditor,
    )
    const store = new SchemaRowStore(this.name, this.description$, this.displayDescription$, this.nullable$, this.schemaKind$, context)
    return (this.schemaRowStoreCache = this.dispose.add(store))
  }

  public validate(_didValueChange?: boolean): void {
    if (this.context.role === 'guest') {
      // No validation in guest mode.
      return
    }
    if (this.validateFn && this.value$) {
      // References do not need value validation.
      if (this.reference$.value) {
        this.error$.set(void 0)
        return
      }

      // Allow null when the handle is nullable.
      const value = this.value$.value
      if (value === null && this.nullable$.value) {
        this.error$.set(void 0)
        return
      }

      const schemaType = typeOfSchema(this.schema$.value)
      const expected = asPrimitiveType(schemaType)
      const valueType = inferPrimitiveType(value)

      if (expected ? expected !== valueType : value === undefined) {
        this.error$.set({ type: 'typeError' })
        return
      }

      // Binary handles require a connection.
      if (schemaType === 'binary' && !this.reference$.value) {
        this.error$.set({
          type: 'validationError',
          message: '$connectionRequired',
        })
        return
      }

      // Validate the concrete value against the compiled schema.
      const error = validate(this.validateFn, this.value$.value, this.lang$.value)
      if (error && error.length > 0) {
        this.error$.set({
          type: 'validationError',
          message: ajv.errorsText(error),
        })
      } else {
        this.error$.set(void 0)
      }
    }
  }
}
