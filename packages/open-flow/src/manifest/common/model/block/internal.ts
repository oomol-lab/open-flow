import type { ReadonlyVal } from 'value-enhancer'
import type { GroupDividerDef, InputHandleDef, OutputHandleDef } from '../../../../schema/index.ts'

export const BlockManifestKind: unique symbol = Symbol('BlockManifest')
export type BlockManifestKind = typeof BlockManifestKind

export const SharedBlockManifestKind: unique symbol = Symbol('SharedBlockManifest')
export type SharedBlockManifestKind = typeof SharedBlockManifestKind

export const InlineBlockManifestKind: unique symbol = Symbol('InlineBlockManifest')
export type InlineBlockManifestKind = typeof InlineBlockManifestKind

export const TaskBlockManifestKind: unique symbol = Symbol('TaskBlockManifest')
export type TaskBlockManifestKind = typeof TaskBlockManifestKind

export const InlineTaskBlockManifestKind: unique symbol = Symbol('InlineTaskBlockManifest')
export type InlineTaskBlockManifestKind = typeof InlineTaskBlockManifestKind

export const ValueBlockManifestKind: unique symbol = Symbol('ValueBlockManifest')
export type ValueBlockManifestKind = typeof ValueBlockManifestKind

export const ConditionBlockManifestKind: unique symbol = Symbol('ConditionBlockManifest')
export type ConditionBlockManifestKind = typeof ConditionBlockManifestKind

export interface BlockManifestBase$ {
  readonly inputs_def: ReadonlyVal<(InputHandleDef | GroupDividerDef)[] | undefined>
  readonly outputs_def: ReadonlyVal<(OutputHandleDef | GroupDividerDef)[] | undefined>
}
