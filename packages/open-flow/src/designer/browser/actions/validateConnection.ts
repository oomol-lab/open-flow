import type { TFunction } from 'val-i18n'
import type { ReadonlyVal } from 'value-enhancer'
import type { PackageId } from '../../../manifest/common/manifestTypes.ts'
import type { FlowLikeMeta } from '../../../manifest/common/meta/flowLike/flowLikeMeta.ts'
import type { CompareResult, CompareSchemaInfo } from '../../../manifest/common/schemaCompare.ts'
import type { EdgeStore } from '../stores/edge/edge.store.ts'
import type { ManifestConnectionFrom, ManifestConnectionTo } from '../stores/edge/typings.ts'
import type { ErrorMessage } from '../stores/node/constants.ts'

import { coalesce, isString } from '@wopjs/cast'
import { WeakCache } from '@wopjs/weak-cache'
import { combine, compute, derive } from 'value-enhancer'
import { shallowPlainObjectEqual } from '../../../base/common/equality.ts'
import { isUnknownRecord } from '../../../base/common/type.ts'
import { SubflowBlockMeta } from '../../../manifest/common/meta/block/subflowBlockMeta.ts'
import { isTriggerNodeManifest } from '../../../manifest/common/model/node/triggerNodeManifest.ts'
import { normalizeNullableSchemaPath } from '../../../manifest/common/schemaCompare.ts'

export interface ConnectionValidateData {
  isScriptlet?: boolean | undefined
  isErrorNode?: boolean | undefined
  packageId?: PackageId | undefined
  kind?: string | undefined
  schema?: unknown
  nullable?: boolean | undefined
}

export function bindValidateConnection(
  flowLikeMeta: FlowLikeMeta,
  compareJSONSchema: (from: CompareSchemaInfo, to: CompareSchemaInfo) => Promise<CompareResult>,
  t$: ReadonlyVal<TFunction>,
  edgeStore: EdgeStore,
): void {
  const fromData$ = getFromConnectionValidateData(flowLikeMeta, edgeStore.connection.from)

  if (!fromData$) return

  const toData$ = getToConnectionValidationData(flowLikeMeta, edgeStore.connection.to)

  if (!toData$) return

  const pResult$ = combine([fromData$, toData$, t$], ([fromData, toData, t]) => validateConnectionData(fromData, toData, compareJSONSchema, t))

  {
    let currentPResult: Promise<ErrorMessage | undefined> | undefined
    edgeStore.dispose.add(
      pResult$.subscribe(async (pResult) => {
        currentPResult = pResult
        const result = await pResult
        if (currentPResult === pResult) {
          edgeStore.$$.error.set(result)
        }
      }),
    )
  }
}

export async function validateConnectionData(
  from: ConnectionValidateData | undefined,
  to: ConnectionValidateData | undefined,
  compareJSONSchema: (from: CompareSchemaInfo, to: CompareSchemaInfo) => Promise<CompareResult>,
  t: TFunction,
): Promise<ErrorMessage | undefined> {
  const OK = undefined

  if (!from || isString(from)) return from
  if (from.isErrorNode) return t('edgeError.errorNode')
  const fromSchemaSource = from.schema
  // Only object-shaped JSON Schemas participate in connection validation.
  if (!isUnknownRecord(fromSchemaSource)) return OK
  if (Object.keys(fromSchemaSource).length === 0) return OK
  const fromSchema = fromSchemaSource

  if (!to || isString(to)) return to
  if (to.isErrorNode) return t('edgeError.errorNode')
  const toSchemaSource = to.schema
  // Only object-shaped JSON Schemas participate in connection validation.
  if (!isUnknownRecord(toSchemaSource)) return OK
  if (Object.keys(toSchemaSource).length === 0) return OK
  const toSchema = toSchemaSource

  if (from.kind && to.kind) {
    // Custom handle kinds must match on both ends.
    if (!compareKind(from.kind, to.kind)) {
      return t('edgeError.diffKind')
    }
  }

  if (from.nullable || !to.nullable) {
    if (fromSchema.type === 'null') {
      if (toSchema.type !== 'null') {
        return t('edgeError.nullable')
      }
    }

    if (toSchema.type === 'null') {
      if (fromSchema.type !== 'null') {
        return t('edgeError.nullable')
      }
    }
  }

  if (fromSchema.contentMediaType === 'oomol/bin' || toSchema.contentMediaType === 'oomol/bin') {
    if (fromSchema.contentMediaType === toSchema.contentMediaType) {
      if (from.nullable && !to.nullable) {
        return t('edgeError.nullable')
      }
      return OK
    }
    return t('edgeError.binDiffType')
  }

  const result = await compareJSONSchema(
    {
      schema: from.nullable ? { anyOf: [fromSchema, { type: 'null' }] } : fromSchema,
      packageId: from.packageId,
    },
    {
      schema: to.nullable ? { anyOf: [toSchema, { type: 'null' }] } : toSchema,
      packageId: to.packageId,
    },
  )

  if (result.kind === 'compatible') {
    return OK
  } else if (result.kind === 'compare-error') {
    return t('edgeError.default')
  } else if (result.error) {
    return t(result.error)
  }

  const errorPath = normalizeNullableSchemaPath(result.errorPath, to.nullable)
  if (errorPath) {
    return `${t('edgeError.default')} (${toJSONPointer(errorPath)})`
  }

  return t('edgeError.default')
}

function toJSONPointer(path: readonly (string | number)[]): string {
  if (path.length === 0) return '#'
  return `#/${path.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}

export function getFromConnectionValidateData(
  flowLikeMeta: FlowLikeMeta,
  from: ManifestConnectionFrom,
): ReadonlyVal<ConnectionValidateData | undefined> | undefined {
  if (from.type === 'from_flow') {
    if (SubflowBlockMeta.is(flowLikeMeta)) {
      return compute(
        (get) => {
          const handle = get(flowLikeMeta.$.inputHandleDefs)?.find((candidate) => candidate.handle === from.source.input_handle)
          if (!handle) return

          return {
            isScriptlet: false,
            packageId: flowLikeMeta.packageMeta.packageId,
            kind: handle.kind,
            schema: handle.json_schema,
            nullable: handle.nullable,
          }
        },
        { equal: shallowPlainObjectEqual },
      )
    }
    return
  }

  const nodeMeta$ = derive(flowLikeMeta.nodes.$, (nodes) => {
    return nodes.get(from.source.node_id)
  })

  return compute(
    (get) => {
      const nodeMeta = get(nodeMeta$)
      // Ignore connections whose source node no longer exists.
      if (!nodeMeta) return

      const blockMeta = get(nodeMeta.$.blockMeta)
      const trigger = isTriggerNodeManifest(nodeMeta.manifest)

      // Keep invalid block references visible as connection errors.
      if (!blockMeta && !trigger) return { isErrorNode: true }

      const outputHandleDefs = get(nodeMeta.$.allOutputHandleDefs)
      const handle = outputHandleDefs?.find((candidate) => {
        return candidate.handle === from.source.output_handle
      })
      // Ignore connections whose source handle no longer exists.
      if (!handle) return

      return {
        isScriptlet: nodeMeta.isScriptlet(),
        packageId: nodeMeta.flowLikeMeta.packageMeta.packageId,
        kind: handle.kind,
        schema: handle.json_schema,
        nullable: handle.nullable,
      }
    },
    { equal: shallowPlainObjectEqual },
  )
}

export function getToConnectionValidationData(
  flowLikeMeta: FlowLikeMeta,
  to: ManifestConnectionTo,
): ReadonlyVal<ConnectionValidateData | undefined> | undefined {
  if (to.type === 'to_flow') {
    if (SubflowBlockMeta.is(flowLikeMeta)) {
      return compute(
        (get) => {
          const handle = get(flowLikeMeta.$.outputHandleDefs)?.find((candidate) => candidate.handle === to.target.output_handle)
          if (!handle) return

          return {
            isScriptlet: false,
            packageId: flowLikeMeta.packageMeta.packageId,
            kind: handle.kind,
            schema: handle.json_schema,
            nullable: handle.nullable,
          }
        },
        { equal: shallowPlainObjectEqual },
      )
    }
    return
  }

  if (to.type !== 'to_node') return

  {
    const nodeMeta$ = derive(flowLikeMeta.nodes.$, (nodes) => {
      return nodes.get(to.target.node_id)
    })

    return compute(
      (get) => {
        const nodeMeta = get(nodeMeta$)
        // Ignore connections whose target node no longer exists.
        if (!nodeMeta) return

        const blockMeta = get(nodeMeta.$.blockMeta)

        // Keep invalid block references visible as connection errors.
        if (!blockMeta) return { isErrorNode: true }

        const handle = get(nodeMeta.$.allInputHandleDefs)?.find((candidate) => {
          return candidate.handle === to.target.input_handle
        })
        // Ignore connections whose target handle no longer exists.
        if (!handle) return

        return {
          isScriptlet: nodeMeta.isScriptlet(),
          packageId: blockMeta?.packageMeta.packageId,
          kind: handle.kind,
          schema: handle.json_schema,
          nullable: handle.nullable,
        }
      },
      { equal: shallowPlainObjectEqual },
    )
  }
}

const kindSetCache = new WeakCache<string, Set<string>>()
function compareKind(kindFrom?: string, kindTo?: string): boolean {
  if (!kindFrom || !kindTo) return kindFrom === kindTo

  let setFrom = kindSetCache.get(kindFrom)
  if (!setFrom) {
    kindSetCache.set(kindFrom, (setFrom = new Set(coalesce(kindFrom.split('|')))))
  }

  let setTo = kindSetCache.get(kindTo)
  if (!setTo) {
    kindSetCache.set(kindTo, (setTo = new Set(coalesce(kindTo.split('|')))))
  }

  return setFrom.isSubsetOf(setTo)
}
