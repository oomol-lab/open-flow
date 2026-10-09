export const NodeManifestKind: unique symbol = Symbol('NodeManifest')
export type NodeManifestKind = typeof NodeManifestKind

export const TaskNodeManifestKind: unique symbol = Symbol('TaskNodeManifest')
export type TaskNodeManifestKind = typeof TaskNodeManifestKind

export const ValueNodeManifestKind: unique symbol = Symbol('ValueNodeManifest')
export type ValueNodeManifestKind = typeof ValueNodeManifestKind

export const ConditionNodeManifestKind: unique symbol = Symbol('ConditionNodeManifest')
export type ConditionNodeManifestKind = typeof ConditionNodeManifestKind

export const TriggerNodeManifestKind: unique symbol = Symbol('TriggerNodeManifest')
export type TriggerNodeManifestKind = typeof TriggerNodeManifestKind
