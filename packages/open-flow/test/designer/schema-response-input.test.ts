import type { JsonValue, RevisionContent } from '../../src/flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { compileAuthoring } from '../../src/control/common/authoring.ts'
import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { validateFlowGraph } from '../../src/flow/common/graph.ts'
import { matchesSchema } from '../../src/flow/common/schema.ts'
import { createSchemaComparer } from '../../src/flow/common/schemaComparer.ts'
import { SubsetCompareResult } from '../../src/json-schema-subset/index.ts'

const responseInput = {
  anyOf: [
    {
      type: 'string',
      description: 'A plain text prompt.',
    },
    {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            enum: ['system', 'user', 'assistant', 'developer'],
            description: 'The role of the message author.',
          },
          content: {
            anyOf: [
              {
                type: 'string',
                description: 'Plain text content for a simple message.',
              },
              {
                type: 'array',
                items: {
                  anyOf: [
                    {
                      type: 'object',
                      properties: {
                        type: {
                          const: 'input_text',
                          description: 'The content type. Must be input_text.',
                        },
                        text: {
                          type: 'string',
                          description: 'The text content sent to the model.',
                        },
                      },
                      required: ['type', 'text'],
                      additionalProperties: false,
                      description: 'A text content block for a response input message.',
                    },
                    {
                      type: 'object',
                      properties: {
                        type: {
                          const: 'input_image',
                          description: 'The content type. Must be input_image.',
                        },
                        image_url: {
                          type: 'string',
                          description: 'A remote image URL or a data URL containing the image bytes.',
                        },
                        detail: {
                          type: 'string',
                          enum: ['auto', 'low', 'high', 'original'],
                          description: 'The requested image detail level.',
                        },
                      },
                      required: ['type', 'image_url'],
                      additionalProperties: false,
                      description: 'An image content block for a response input message.',
                    },
                    {
                      type: 'object',
                      properties: {
                        type: {
                          const: 'input_file',
                          description: 'The content type. Must be input_file.',
                        },
                        file_id: {
                          type: 'string',
                          description: 'The uploaded file ID to reference.',
                        },
                        file_data: {
                          type: 'string',
                          description: 'The inline file data encoded as base64 or supplied as a data URL.',
                        },
                        filename: {
                          type: 'string',
                          description: 'The filename to report for inline file data.',
                        },
                      },
                      required: ['type'],
                      additionalProperties: false,
                      description: 'A file content block for a response input message.',
                    },
                  ],
                  description: 'A structured content block.',
                },
                minItems: 1,
                description: 'Structured multimodal content blocks.',
              },
            ],
            description: 'The content for the message.',
          },
        },
        required: ['role', 'content'],
        additionalProperties: false,
        description: 'A message in the Responses API input array.',
      },
      minItems: 1,
      description: 'An ordered array of conversation messages.',
    },
  ],
  description: 'The input prompt or message array sent to the model.',
} as const satisfies JsonValue

function subset(from: object, to: object) {
  const comparer = createSchemaComparer()
  return comparer.isSubset(comparer.compile(from, { error: {} }), comparer.compile(to, { error: {} })).result
}

async function responseGraph(outputSchema: object, inputSchema: object = responseInput): Promise<RevisionContent> {
  const base: RevisionContent = { modelVersion: currentFlowModelVersion, modules: {}, document: { graph: { nodes: {}, edges: [] }, bindings: {} } }
  const action = {
    actionId: 'test.response',
    name: 'Response',
    serviceId: 'test',
    serviceName: 'Test',
    authenticated: false,
    description: '',
    inputs: { input: { jsonSchema: JSON.parse(JSON.stringify(inputSchema)), nullable: false } },
    outputs: {},
  }
  const created = await compileAuthoring(
    base,
    {
      baseRevision: 'base',
      requestId: 'response',
      edits: [
        {
          op: 'node.add',
          as: 'producer',
          type: 'code',
          name: 'Producer',
          code: 'export default () => ({input: [{role: "user", content: "hello"}]})',
          config: { outputs: { input: { schema: JSON.parse(JSON.stringify(outputSchema)), nullable: false } } },
        },
        {
          op: 'node.add',
          as: 'response',
          type: 'connector',
          name: 'Response',
          config: { action: action.actionId },
          inputs: { input: { kind: 'output', node: '$producer', port: 'input' } },
        },
      ],
    },
    {
      id: (label) => label,
      action: async () => action,
      trigger: async () => {
        throw Error('unexpected')
      },
      openapi: async () => {
        throw Error('unexpected')
      },
    },
  )
  return created.content
}

describe('multimodal input schema comparisons', () => {
  const arrayBranch = responseInput.anyOf[1]!
  it('accepts independently compiled identical unions and the array branch', () => {
    expect(subset(responseInput, structuredClone(responseInput))).toBe(SubsetCompareResult.True)
    expect(subset(arrayBranch, responseInput)).toBe(SubsetCompareResult.True)
  })
  it('continues rejecting broader or incompatible values', () => {
    expect(subset({}, responseInput)).not.toBe(SubsetCompareResult.True)
    expect(subset({ type: 'boolean' }, responseInput)).not.toBe(SubsetCompareResult.True)
    const changed: object = JSON.parse(JSON.stringify(arrayBranch).replace('"original"', '"unrecognized"'))
    expect(subset(changed, responseInput)).not.toBe(SubsetCompareResult.True)
    expect(subset(responseInput, arrayBranch)).not.toBe(SubsetCompareResult.True)
  })
  it.each([responseInput, arrayBranch])('accepts public node.add output bound to the matching catalog input', async (schema) => {
    const content = await responseGraph(schema)
    expect(validateFlowGraph(content).filter((d) => d.code === 'graph.node-output-incompatible')).toEqual([])
  })
  it.each([{ minLength: 8 }, { pattern: '^(assistant|developer)$' }])(
    'rejects a catalog input with stricter nested enum constraints %j',
    async (constraint) => {
      const restricted = structuredClone(responseInput)
      Object.assign(restricted.anyOf[1]!.items!.properties.role, constraint)
      const sample = [{ role: 'user', content: 'hello' }]
      expect(matchesSchema(sample, responseInput)).toBe(true)
      expect(matchesSchema(sample, restricted)).toBe(false)
      expect(subset(responseInput, restricted)).not.toBe(SubsetCompareResult.True)
      const content = await responseGraph(responseInput, restricted)
      expect(validateFlowGraph(content)).toContainEqual(expect.objectContaining({ code: 'graph.node-output-incompatible' }))
    },
  )
})
