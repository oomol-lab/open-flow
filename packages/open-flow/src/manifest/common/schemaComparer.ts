import type { ExtendsSchema, SubsetCompare } from '../../json-schema-subset/index.ts'

import { isString, toPlainObject } from '@wopjs/cast'
import { CompiledKind, getKind, isCompiledSchema } from '../../json-schema-subset/compiler/index.ts'
import { ExpressionSingleResult, makeSubsetCompare } from '../../json-schema-subset/index.ts'

export interface SchemaCompareContext {
  readonly packageId?: string
  readonly error: { message?: string }
}

interface StringSchemaValue {
  readonly type: 'string'
}

function isStringLikeSchema(value: unknown): value is StringSchemaValue {
  return toPlainObject(value)?.type === 'string'
}

function assertSchemaCompareContext(value: unknown): asserts value is SchemaCompareContext {
  const context = toPlainObject(value)
  const error = toPlainObject(context?.error)
  if (context == null || error == null || (context.packageId != null && !isString(context.packageId)) || (error.message != null && !isString(error.message))) {
    throw new TypeError('Invalid schema comparison context.')
  }
}

function parseSchemaCompareContext(value: unknown): SchemaCompareContext {
  if (value == null) return { error: {} }
  assertSchemaCompareContext(value)
  return value
}

abstract class SpecialSchema<T = unknown> implements ExtendsSchema {
  public static setError(fromSchema: unknown, toSchema: unknown, message: string): void {
    if (fromSchema instanceof SpecialSchema) {
      fromSchema.context.error.message = message
    } else if (toSchema instanceof SpecialSchema) {
      toSchema.context.error.message = message
    }
  }

  public readonly id: number
  public readonly value: T
  public readonly context: SchemaCompareContext

  protected constructor(id: number, value: T, context?: unknown) {
    this.id = id
    this.value = value
    this.context = parseSchemaCompareContext(context)
  }

  public compare(other: unknown): readonly ExpressionSingleResult[] {
    if (isCompiledSchema(other) && getKind(other) === CompiledKind.Any) return [ExpressionSingleResult.ContainedBy]
    return this.compareImpl(other)
  }

  protected abstract compareImpl(other: unknown): readonly ExpressionSingleResult[]

  public abstract equals(other: unknown): boolean
}

interface SingleSelectSchemaValue {
  readonly enum: readonly string[]
}

class SingleSelectSchema extends SpecialSchema<SingleSelectSchemaValue> {
  public static isMatch(value: unknown): value is SingleSelectSchemaValue {
    const enumValues = toPlainObject(value)?.enum
    return Array.isArray(enumValues) && enumValues.every((v) => isString(v))
  }

  public constructor(id: number, value: unknown, context?: unknown) {
    if (!SingleSelectSchema.isMatch(value)) throw new TypeError('Invalid single-select schema.')
    super(id, value, context)
  }

  protected compareImpl(other: unknown): readonly ExpressionSingleResult[] {
    if (isStringLikeSchema(other)) {
      return [ExpressionSingleResult.ContainedBy]
    }

    if (other instanceof SingleSelectSchema) {
      const f = new Set(this.value.enum)
      let result: ExpressionSingleResult = ExpressionSingleResult.Equals
      for (const v of other.value.enum) {
        if (!f.has(v)) {
          result = ExpressionSingleResult.ContainedBy
        }
        f.delete(v)
      }
      if (f.size === 0) {
        return [result]
      }
      if (f.size === this.value.enum.length) {
        return [ExpressionSingleResult.Rejection]
      }
      return [ExpressionSingleResult.Intersection]
    }

    return [ExpressionSingleResult.Rejection]
  }

  public equals(other: unknown): boolean {
    if (other instanceof SingleSelectSchema) {
      const f = new Set(this.value.enum)
      for (const v of other.value.enum) {
        if (!f.has(v)) {
          return false
        }
        f.delete(v)
      }
      return f.size === 0
    }
    return false
  }
}

interface BinarySchemaValue {
  readonly contentMediaType: 'oomol/bin'
}

class BinarySchema extends SpecialSchema<BinarySchemaValue> {
  public static isMatch(value: unknown): value is BinarySchemaValue {
    return toPlainObject(value)?.contentMediaType === 'oomol/bin'
  }

  public constructor(id: number, value: unknown, context?: unknown) {
    if (!BinarySchema.isMatch(value)) throw new TypeError('Invalid binary schema.')
    super(id, value, context)
  }

  protected compareImpl(other: unknown): readonly ExpressionSingleResult[] {
    if (other instanceof BinarySchema) {
      return [ExpressionSingleResult.Equals]
    } else {
      SpecialSchema.setError(this, other, 'edgeError.binDiffType')
      return [ExpressionSingleResult.Rejection]
    }
  }

  public equals(other: unknown): boolean {
    return other instanceof BinarySchema
  }
}

interface ArtifactSchemaValue {
  readonly contentMediaType: 'oomol/artifact'
}

class ArtifactSchema extends SpecialSchema<ArtifactSchemaValue> {
  public static isMatch(value: unknown): value is ArtifactSchemaValue {
    return toPlainObject(value)?.contentMediaType === 'oomol/artifact'
  }

  public constructor(id: number, value: unknown, context?: unknown) {
    if (!ArtifactSchema.isMatch(value)) throw new TypeError('Invalid Artifact schema.')
    super(id, value, context)
  }

  protected compareImpl(other: unknown): readonly ExpressionSingleResult[] {
    if (other instanceof ArtifactSchema) return [ExpressionSingleResult.Equals]
    SpecialSchema.setError(this, other, 'edgeError.artifactDiffType')
    return [ExpressionSingleResult.Rejection]
  }

  public equals(other: unknown): boolean {
    return other instanceof ArtifactSchema
  }
}

export function createSchemaComparer(): SubsetCompare<unknown> {
  const comparer = makeSubsetCompare({
    extendsSchemaClasses: [SingleSelectSchema, BinarySchema, ArtifactSchema],
  })

  return comparer
}
