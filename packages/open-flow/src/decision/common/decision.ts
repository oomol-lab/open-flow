import type { InputPort, JsonValue, ManagedTaskDefinition, Port } from '../../flow/common/change.ts'

import { dequal } from 'dequal/lite'
import { matchesSchema } from '../../flow/common/schema.ts'

export type DecisionQuestion = { readonly name: string; readonly instructions: string } & (
  | { readonly type: 'noul'; readonly criteria?: { readonly true?: string; readonly false?: string } }
  | { readonly type: 'choice'; readonly criteria: readonly { readonly name: string; readonly description: string }[] }
  | { readonly type: 'score'; readonly criteria: readonly string[] }
)
export interface DecisionExecutor {
  readonly kind: 'decision'
  readonly questions: readonly DecisionQuestion[]
}
export interface DecisionIssue {
  readonly question?: number
  readonly field: 'questions' | 'name' | 'instructions' | 'criteria' | 'ports'
  readonly message: string
}

export const decisionModel = 'typesafe/jev'
export const decisionLimits = { choice: 255, score: 10 } as const

/** Ordered prefixes are shared by authoring, schemas, validation, and execution. */
export function limitDecisionQuestion(question: DecisionQuestion): DecisionQuestion {
  if (question.type === 'noul' || question.criteria.length <= decisionLimits[question.type]) return question
  if (question.type === 'choice') return { ...question, criteria: question.criteria.slice(0, decisionLimits.choice) }
  return { ...question, criteria: question.criteria.slice(0, decisionLimits.score) }
}

export function limitDecisionQuestions(questions: readonly DecisionQuestion[]): readonly DecisionQuestion[] {
  const limited = questions.map(limitDecisionQuestion)
  return limited.every((question, i) => question === questions[i]) ? questions : limited
}

/** Loading an oversized task also updates its previously generated output schemas. */
export function limitDecisionTask(task: ManagedTaskDefinition): ManagedTaskDefinition {
  if (task.executor.kind !== 'decision') return task
  const original = task.executor.questions
  const questions = limitDecisionQuestions(original)
  if (questions === original) return task
  const outputs = task.outputs.map((port) => {
    if (!('handle' in port)) return port
    const index = original.findIndex((question) => question.name === port.handle)
    if (index < 0 || original[index] === questions[index] || !dequal(port.jsonSchema, answerSchema(original[index]!))) return port
    return { ...port, jsonSchema: decisionAnswerSchema(questions[index]!) }
  })
  return { ...task, executor: { ...task.executor, questions }, outputs }
}
export const decisionStateSchema: JsonValue = { type: ['string', 'object', 'array'] }
const probability: JsonValue = { type: 'number', minimum: 0, maximum: 1 }
export const defaultDecisionQuestion = (name = 'decision1'): DecisionQuestion => ({ name, type: 'noul', instructions: '' })

export function decisionQuestionIssues(questions: readonly DecisionQuestion[]): readonly DecisionIssue[] {
  questions = limitDecisionQuestions(questions)
  const issues: DecisionIssue[] = []
  if (!questions.length) issues.push({ field: 'questions', message: 'Add at least one question.' })
  questions.forEach((question, index) => {
    const add = (field: DecisionIssue['field'], message: string) => issues.push({ question: index, field, message })
    if (!question.name.trim() || question.name === '__proto__' || questions.some((other, i) => i !== index && other.name === question.name))
      add('name', 'Question names must be non-empty and unique; __proto__ is reserved.')
    if (!question.instructions.trim()) add('instructions', 'Describe the question to evaluate.')
    if (question.type === 'choice') {
      if (!question.criteria.length) add('criteria', 'Provide between 1 and 255 choices.')
      const names = question.criteria.map((item) => item.name)
      if (names.some((name) => !name.trim() || name === '__proto__') || new Set(names).size !== names.length)
        add('criteria', 'Choice names must be non-empty and unique; __proto__ is reserved.')
    }
    if (question.type === 'score' && (question.criteria.length < 2 || question.criteria.some((level) => !level.trim())))
      add('criteria', 'Provide between 2 and 10 non-empty levels, in increasing order.')
  })
  return issues
}

export function decisionAnswerSchema(question: DecisionQuestion): JsonValue {
  return answerSchema(limitDecisionQuestion(question))
}

function answerSchema(question: DecisionQuestion): JsonValue {
  const properties: Record<string, JsonValue> = { type: { const: question.type } }
  if (question.type === 'noul') properties.noul = probability
  else {
    const keys = question.type === 'choice' ? question.criteria.map((item) => item.name) : question.criteria.map((_, index) => String(index))
    properties.confidence = probability
    properties.probabilities = {
      type: 'object',
      properties: Object.fromEntries(keys.map((key) => [key, probability])),
      required: keys,
      additionalProperties: false,
    }
    if (question.type === 'choice') properties.choice = { type: 'string', ...(keys.length ? { enum: keys } : {}) }
    else {
      properties.score = { type: 'number', minimum: 0, maximum: Math.max(0, keys.length - 1) }
      properties.legend = {
        type: 'object',
        properties: Object.fromEntries(keys.map((key) => [key, { type: 'string' }])),
        required: keys,
        additionalProperties: false,
      }
    }
  }
  return { type: 'object', properties, required: Object.keys(properties) }
}

export function decisionTask(questions: readonly DecisionQuestion[] = [defaultDecisionQuestion()], name = 'AI Decision'): ManagedTaskDefinition {
  questions = limitDecisionQuestions(questions)
  const inputs: InputPort[] = [
    { handle: 'target', description: 'Text, object, or array to evaluate across all questions.', jsonSchema: decisionStateSchema, nullable: false },
  ]
  const outputs: Port[] = questions.map((question) => ({ handle: question.name, jsonSchema: decisionAnswerSchema(question), nullable: false }))
  return { name, executor: { kind: 'decision', questions }, inputs, outputs }
}

export function decisionTaskIssues(task: ManagedTaskDefinition): readonly DecisionIssue[] {
  task = limitDecisionTask(task)
  if (task.executor.kind !== 'decision') return []
  const expected = decisionTask(task.executor.questions, task.name)
  return [
    ...decisionQuestionIssues(task.executor.questions),
    ...(!dequal(task.inputs, expected.inputs) || !dequal(task.outputs, expected.outputs)
      ? [{ field: 'ports' as const, message: 'AI Decision ports must match its questions.' }]
      : []),
  ]
}

export function decisionRequest(questions: readonly DecisionQuestion[], state: JsonValue): JsonValue {
  questions = limitDecisionQuestions(questions)
  const issues = decisionQuestionIssues(questions)
  if (issues.length) throw new TypeError(issues[0]!.message)
  if (!matchesSchema(state, decisionStateSchema)) throw new TypeError('Decision state must be text, an object, or an array.')
  return {
    model: decisionModel,
    state,
    questions: Object.fromEntries(
      questions.map((question) => [
        question.name,
        {
          type: question.type,
          instructions: question.instructions,
          ...(question.type === 'choice'
            ? { criteria: Object.fromEntries(question.criteria.map((item) => [item.name, item.description || null])) }
            : question.criteria == null
              ? {}
              : { criteria: question.criteria }),
        },
      ]),
    ),
  }
}

export function decisionAnswers(questions: readonly DecisionQuestion[], response: unknown): Readonly<Record<string, JsonValue>> {
  questions = limitDecisionQuestions(questions)
  const source = response as { answers?: unknown } | null
  const answers = source?.answers
  if (answers == null || typeof answers !== 'object' || Array.isArray(answers)) throw new TypeError('The model returned no answers.')
  return Object.fromEntries(
    questions.map((question) => {
      const answer = Object.hasOwn(answers, question.name) ? (answers as Record<string, JsonValue>)[question.name] : undefined
      if (answer === undefined || !matchesSchema(answer, decisionAnswerSchema(question))) throw new TypeError(`Invalid answer for "${question.name}".`)
      if (question.type !== 'noul') {
        const distribution = (answer as Record<string, JsonValue>).probabilities as Record<string, number>
        if (Math.abs(Object.values(distribution).reduce((sum, value) => sum + value, 0) - 1) > 0.0001)
          throw new TypeError(`Invalid probability distribution for "${question.name}".`)
      }
      return [question.name, answer]
    }),
  )
}
