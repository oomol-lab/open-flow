import type { RevisionContent, TriggerNode, WebhookBodyField } from '../../flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { currentFlowModelVersion } from '../../flow/common/change.ts'
import { validateFlow } from '../../flow/common/semantics.ts'
import { findEngineContract } from '../../runtime/common/engineContract.ts'
import { currentEngineContract } from '../../runtime/common/runtime.ts'
import { renderWebhookFormPage, webhookFormBody, webhookFormControl, WebhookFormInvalid, webhookFormIssues } from './webhookForm.ts'

type WebhookNode = Extract<TriggerNode, { readonly kind: 'webhook' }>

const fields: readonly WebhookBodyField[] = [
  { handle: 'name', jsonSchema: { description: 'Full name', title: 'Name', type: 'string' }, nullable: false },
  { handle: 'age', jsonSchema: { type: 'integer' }, nullable: true },
  { handle: 'score', jsonSchema: { type: 'number' }, nullable: true },
  { handle: 'agree', jsonSchema: { type: 'boolean' }, nullable: false },
  { handle: 'plan', jsonSchema: { enum: ['free', 'pro'], type: 'string' }, nullable: true, value: 'free' },
]

function entries(...pairs: readonly (readonly [string, FormDataEntryValue])[]): Iterable<[string, FormDataEntryValue]> {
  return pairs.map(([name, value]) => [name, value])
}

function webhook(options: WebhookNode['options'], bodyFields: readonly WebhookBodyField[] = fields): WebhookNode {
  return { bodyFields, kind: 'webhook', method: 'POST', name: 'Signup', options }
}

describe('webhookFormBody', () => {
  it('converts submitted strings to the declared field types', () => {
    expect(webhookFormBody(fields, entries(['name', 'Ada'], ['age', '36'], ['score', '1.5'], ['agree', 'on'], ['plan', 'pro'], ['other', 'x']))).toEqual({
      age: 36,
      agree: true,
      name: 'Ada',
      plan: 'pro',
      score: 1.5,
    })
  })

  it('treats an absent or explicitly false checkbox as false and omits empty values', () => {
    expect(webhookFormBody(fields, entries(['name', 'Ada'], ['age', '']))).toEqual({ agree: false, name: 'Ada' })
    for (const value of ['false', '0']) expect(webhookFormBody(fields, entries(['agree', value]))).toEqual({ agree: false })
  })

  it('rejects files, repeated fields and invalid numbers', () => {
    for (const submitted of [
      entries(['name', new File(['x'], 'name.txt')]),
      entries(['name', 'Ada'], ['name', 'Grace']),
      entries(['age', '1.5']),
      entries(['age', 'many']),
      entries(['score', 'Infinity']),
    ])
      expect(() => webhookFormBody(fields, submitted)).toThrow(WebhookFormInvalid)
  })
})

describe('webhookFormControl', () => {
  it('maps supported field types and refuses the rest', () => {
    expect(fields.map((field) => webhookFormControl(field)?.kind)).toEqual(['text', 'integer', 'number', 'checkbox', 'select'])
    expect(webhookFormControl(fields[0]!)).toMatchObject({ help: 'Full name', label: 'Name', required: true })
    expect(webhookFormControl(fields[3]!)).toMatchObject({ required: false })
    expect(webhookFormControl(fields[4]!)).toMatchObject({ defaultValue: 'free', options: ['free', 'pro'] })
    expect(webhookFormControl({ handle: 'tags', jsonSchema: { items: { type: 'string' }, type: 'array' }, nullable: true })).toBeUndefined()
  })
})

describe('hosted form settings', () => {
  it('reports settings a browser form cannot satisfy', () => {
    expect(webhookFormIssues(webhook(undefined))).toEqual([])
    expect(webhookFormIssues(webhook({ form: {} }))).toEqual([])
    const conflicting: WebhookNode = {
      ...webhook(
        {
          authentication: { secret: { bindingId: 'secret', kind: 'binding' }, type: 'bearer' },
          bodyMode: 'any',
          form: {},
          responseBody: { kind: 'webhook-response', nodeId: 'reply' },
        },
        [...fields, { handle: 'tags', jsonSchema: { type: 'array' }, nullable: true }],
      ),
      method: 'PUT',
    }
    expect(webhookFormIssues(conflicting)).toEqual([
      { code: 'conflict', setting: 'method' },
      { code: 'conflict', setting: 'authentication' },
      { code: 'conflict', setting: 'bodyMode' },
      { code: 'conflict', setting: 'responseBody' },
      { code: 'field-unsupported', field: 'tags' },
    ])
  })

  it('surfaces the issues as Flow diagnostics', async () => {
    const node: WebhookNode = { ...webhook({ form: {} }, [{ handle: 'tags', jsonSchema: { type: 'array' }, nullable: true }]), method: 'PUT' }
    const content: RevisionContent = {
      document: { bindings: {}, graph: { edges: [], nodes: { hook: node } } },
      modelVersion: currentFlowModelVersion,
      modules: {},
    }
    const diagnostics = (await validateFlow(content, findEngineContract(currentEngineContract)!)).diagnostics
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'trigger.webhook-form-conflict', path: '/document/graph/nodes/hook/method' }),
        expect.objectContaining({ code: 'trigger.webhook-form-field-unsupported', path: '/document/graph/nodes/hook/bodyFields/0' }),
      ]),
    )
  })
})

describe('renderWebhookFormPage', () => {
  it('escapes published text and renders a control per field', () => {
    const html = renderWebhookFormPage({
      acceptLanguage: 'zh-CN,zh;q=0.9',
      bodyFields: [...fields, { handle: 'x"><script>', jsonSchema: { type: 'string' }, nullable: true }],
      form: { description: '<b>hi</b>', submitLabel: 'Go & send' },
      name: '<Signup>',
    })
    expect(html).toContain('<html lang="zh-CN">')
    expect(html).toContain('<title>&#60;Signup&#62;</title>')
    expect(html).toContain('Go &#38; send')
    expect(html).not.toContain('<b>hi</b>')
    expect(html).not.toContain('<script>')
    for (const name of ['name', 'age', 'score', 'agree', 'plan']) expect(html).toContain(`name="${name}"`)
  })

  it('renders success and failure results', () => {
    const base = { bodyFields: fields, form: { successMessage: 'Thanks <3' }, name: 'Signup' }
    const success = renderWebhookFormPage({ ...base, acceptLanguage: 'en', result: { status: 202 } })
    expect(success).toContain('Thanks &#60;3')
    expect(success).not.toContain('<form')
    const failure = renderWebhookFormPage({ ...base, acceptLanguage: 'en', result: { status: 413 } })
    expect(failure).toContain('role="alert"')
    expect(failure).not.toContain('<form')
  })
})
