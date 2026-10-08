import type { RevisionContent } from '../../flow/common/change.ts'
import type { DecisionQuestion } from './decision.ts'

import { describe, expect, it } from 'vitest'
import { applyFlowChanges, currentFlowModelVersion } from '../../flow/common/change.ts'
import { decodeRevision, encodeRevision } from '../../flow/common/encoding.ts'
import { inverseFlowChanges } from '../../flow/common/inverseChanges.ts'
import { createDecisionTask } from '../../flow/common/nodeChanges.ts'
import { sourcePort } from '../../flow/common/sourceField.ts'
import {
  decisionAnswerSchema,
  decisionAnswers,
  decisionLimits,
  decisionQuestionIssues,
  decisionRequest,
  decisionTask,
  decisionTaskIssues,
  limitDecisionTask,
} from './decision.ts'

const questions: readonly DecisionQuestion[] = [
  { name: 'needs_support', type: 'noul', instructions: 'Does the customer need support?' },
  {
    name: 'department',
    type: 'choice',
    instructions: 'Which department?',
    criteria: [
      { name: 'billing', description: 'Payments' },
      { name: 'technical', description: '' },
    ],
  },
  { name: 'urgency', type: 'score', instructions: 'How urgent?', criteria: ['Low', 'High'] },
]
const answers = {
  needs_support: { type: 'noul', noul: 0.96 },
  department: { type: 'choice', choice: 'billing', probabilities: { billing: 0.9, technical: 0.1 }, confidence: 0.8 },
  urgency: { type: 'score', score: 0.7, legend: { '0': 'Low', '1': 'High' }, probabilities: { '0': 0.3, '1': 0.7 }, confidence: 0.4 },
}
const empty: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: { bindings: {}, tasks: {}, subflows: {}, graph: { edges: [], nodes: {} } },
}

describe('AI Decision contracts', () => {
  it('batches independent questions with the fixed model and preserves structured state', () => {
    const state = { message: 'Help', order: { paid: true } }
    expect(decisionRequest(questions, state)).toEqual({
      model: 'typesafe/jev',
      state,
      questions: {
        needs_support: { type: 'noul', instructions: 'Does the customer need support?' },
        department: { type: 'choice', instructions: 'Which department?', criteria: { billing: 'Payments', technical: null } },
        urgency: { type: 'score', instructions: 'How urgent?', criteria: ['Low', 'High'] },
      },
    })
    for (const invalidState of [null, true, 42]) expect(() => decisionRequest(questions, invalidState)).toThrow()
    expect(() => decisionRequest(questions, ['message'])).not.toThrow()
  })
  it('projects each complete answer without flattening or exposing the response wrapper', () => {
    expect(decisionAnswers(questions, { answers, model: 'resolved-model', usage: {} })).toEqual(answers)
    expect(decisionAnswers(questions.slice(0, 1), { answers })).toEqual({ needs_support: answers.needs_support })
    const task = decisionTask(questions)
    expect(task.inputs).toEqual([
      {
        handle: 'target',
        description: 'Text, object, or array to evaluate across all questions.',
        jsonSchema: { type: ['string', 'object', 'array'] },
        nullable: false,
      },
    ])
    expect(task.outputs.map((port) => 'handle' in port && port.handle)).toEqual(['needs_support', 'department', 'urgency'])
    expect(decisionTaskIssues(task)).toEqual([])
    expect(
      sourcePort(
        task.outputs.find((port) => 'handle' in port)!,
        'noul',
      ),
    ).toMatchObject({ jsonSchema: { type: 'number', minimum: 0, maximum: 1 } })
  })
  it.each([
    {},
    { needs_support: { type: 'noul', noul: -1 } },
    { needs_support: { type: 'choice', noul: 0.8 } },
    { department: { ...answers.department, choice: 'unknown' } },
    { department: { ...answers.department, probabilities: { billing: 0.2, technical: 0.1 } } },
    { department: { ...answers.department, confidence: 2 } },
    { urgency: { ...answers.urgency, score: 2 } },
    { urgency: { ...answers.urgency, legend: {} } },
  ])('rejects incomplete or invalid answers atomically (%j)', (patch) => {
    expect(() => decisionAnswers(questions, { answers: Object.keys(patch).length ? { ...answers, ...patch } : {} })).toThrow()
  })
  it('diagnoses invalid question configuration and edited generated ports', () => {
    expect(decisionQuestionIssues([])).not.toEqual([])
    expect(decisionQuestionIssues([questions[0]!, questions[0]!]).some((issue) => issue.field === 'name')).toBe(true)
    expect(decisionQuestionIssues([{ name: 'x', type: 'score', instructions: 'Rate', criteria: ['Only'] }])).not.toEqual([])
    const task = decisionTask(questions)
    expect(decisionTaskIssues({ ...task, outputs: [] })).toContainEqual({ field: 'ports', message: 'AI Decision ports must match its questions.' })
  })
  it('round-trips revisions and supports undo/redo of question edits', () => {
    const created = applyFlowChanges(empty, createDecisionTask({ kind: 'flow' }, { taskId: 'decision', nodeId: 'decision' }, 'AI Decision', questions))
    expect(decodeRevision(encodeRevision(created))).toEqual(created)
    const operations = [
      { kind: 'task.decision.set' as const, taskId: 'decision', before: created.document.tasks.decision!, value: decisionTask(questions.slice(0, 1)) },
    ]
    const changed = applyFlowChanges(created, operations)
    expect(applyFlowChanges(changed, inverseFlowChanges(created, operations))).toEqual(created)
    expect(decodeRevision(encodeRevision(changed))).toEqual(changed)
  })
})

describe('AI Decision collection limits', () => {
  const choice: DecisionQuestion = {
    name: 'category',
    type: 'choice',
    instructions: 'Classify',
    criteria: [
      ...Array.from({ length: decisionLimits.choice }, (_, i) => ({ name: `c${i}`, description: '' })),
      { name: '', description: '' },
      { name: 'c0', description: '' },
    ],
  }
  const score: DecisionQuestion = {
    name: 'rating',
    type: 'score',
    instructions: 'Rate',
    criteria: [...Array.from({ length: decisionLimits.score }, (_, i) => `Level ${i}`), ''],
  }
  const oversized = [choice, score]
  const expected = [
    { ...choice, criteria: choice.criteria.slice(0, 255) },
    { ...score, criteria: score.criteria.slice(0, 10) },
  ]
  it('uses the same ordered prefix for configuration, schemas, requests and answer validation', () => {
    expect(decisionQuestionIssues(oversized)).toEqual([])
    const task = decisionTask(oversized)
    expect(task.executor).toEqual({ kind: 'decision', questions: expected })
    expect(decisionTaskIssues(task)).toEqual([])
    expect(decisionRequest(oversized, 'input')).toEqual(decisionRequest(expected, 'input'))
    expect(decisionAnswerSchema(choice)).toEqual(decisionAnswerSchema(expected[0]!))
    expect(decisionAnswerSchema(score)).toEqual(decisionAnswerSchema(expected[1]!))
    const retainedAnswers = {
      category: {
        type: 'choice',
        choice: 'c0',
        confidence: 1,
        probabilities: Object.fromEntries(expected[0]!.criteria.map((_, i) => [`c${i}`, i === 0 ? 1 : 0])),
      },
      rating: {
        type: 'score',
        score: 9,
        confidence: 1,
        probabilities: Object.fromEntries(expected[1]!.criteria.map((_, i) => [String(i), i === 9 ? 1 : 0])),
        legend: Object.fromEntries(expected[1]!.criteria.map((value, i) => [String(i), value])),
      },
    }
    expect(decisionAnswers(oversized, { answers: retainedAnswers })).toEqual(retainedAnswers)
    expect(() => decisionAnswers(oversized, { answers: { ...retainedAnswers, rating: { ...retainedAnswers.rating, score: 10 } } })).toThrow()
    expect(() => decisionAnswers(oversized, { answers: { ...retainedAnswers, category: { ...retainedAnswers.category, choice: 'c255' } } })).toThrow()
    expect(choice.criteria).toHaveLength(257)
    expect(score.criteria).toHaveLength(11)
  })
  it('keeps validation within the retained prefix and does not limit the number of questions', () => {
    expect(decisionQuestionIssues([{ ...score, criteria: ['', ...score.criteria.slice(1)] }])).not.toEqual([])
    expect(decisionQuestionIssues([{ ...choice, criteria: [{ name: 'c1', description: '' }, ...choice.criteria.slice(1)] }])).not.toEqual([])
    const many = Array.from({ length: 300 }, (_, i) => ({ name: `q${i}`, type: 'noul' as const, instructions: 'Evaluate' }))
    expect(decisionTask(many).outputs).toHaveLength(300)
    expect(Object.keys((decisionRequest(many, 'input') as { questions: object }).questions)).toHaveLength(300)
  })
  it('normalizes loaded tasks and generated schemas without hiding unrelated port errors', () => {
    // A stored score schema produced before limits were applied at load time.
    const probability = { type: 'number', minimum: 0, maximum: 1 }
    const keys = score.criteria.map((_, i) => String(i))
    const legacySchema = {
      type: 'object',
      properties: {
        type: { const: 'score' },
        confidence: probability,
        probabilities: { type: 'object', properties: Object.fromEntries(keys.map((key) => [key, probability])), required: keys, additionalProperties: false },
        score: { type: 'number', minimum: 0, maximum: 10 },
        legend: { type: 'object', properties: Object.fromEntries(keys.map((key) => [key, { type: 'string' }])), required: keys, additionalProperties: false },
      },
      required: ['type', 'confidence', 'probabilities', 'score', 'legend'],
    }
    const task = {
      ...decisionTask([score]),
      executor: { kind: 'decision' as const, questions: [score] },
      outputs: [{ handle: score.name, nullable: false, jsonSchema: legacySchema }],
    }
    const content = { ...empty, document: { ...empty.document, tasks: { decision: task } } }
    const decoded = decodeRevision(encodeRevision(content))
    expect(decoded.document.tasks.decision).toEqual(decisionTask([score]))
    expect(decisionTaskIssues(task)).toEqual([])
    expect(limitDecisionTask(task)).toEqual(decisionTask([score]))
    expect(decisionTaskIssues({ ...task, outputs: [] })).toContainEqual({ field: 'ports', message: 'AI Decision ports must match its questions.' })
    const operations = [
      { kind: 'task.decision.set' as const, taskId: 'decision', before: decoded.document.tasks.decision!, value: decisionTask([questions[0]!]) },
    ]
    const changed = applyFlowChanges(decoded, operations)
    expect(applyFlowChanges(changed, inverseFlowChanges(decoded, operations))).toEqual(decoded)
  })
})
