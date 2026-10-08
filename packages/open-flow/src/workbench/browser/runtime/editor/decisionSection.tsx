import fieldStyles from '../../../../form/browser/valueEditor.module.scss'
import type { DecisionQuestion } from '../../../../decision/common/decision.ts'
import type { JsonValue, ManagedTaskDefinition } from '../../../../flow/common/change.ts'
import type { PropertyDeletion } from './propertyDeletion.ts'

import { dequal } from 'dequal/lite'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { decisionLimits, decisionQuestionIssues, decisionTask, defaultDecisionQuestion, limitDecisionQuestions } from '../../../../decision/common/decision.ts'
import { matchesSchema } from '../../../../flow/common/schema.ts'
import { ArrayFieldList } from '../../../../form/browser/arrayFieldList.tsx'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { FieldBody, FieldLayout, FieldRow } from '../../../../form/browser/fieldLayout.tsx'
import { FieldName } from '../../../../form/browser/fieldName.tsx'
import { FieldSelect } from '../../../../form/browser/fieldSelect.tsx'
import { FieldTable } from '../../../../form/browser/fieldTable.tsx'
import { FieldValuePreview } from '../../../../form/browser/fieldValuePreview.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { createTooltipHandle, Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { InspectorSection } from './inspectorSection.tsx'
import { TaskExecutorChanges } from './taskExecutorChanges.ts'

const textSchema = { type: 'string', minLength: 1, pattern: '\\S' }
const instructionSchema = { ...textSchema, 'ui:widget': 'text' }
const nameSchema = (names: readonly string[]) => ({ ...textSchema, not: { enum: ['__proto__', ...names] } })

/** Shared value controls keep drafts until the current asynchronous validation allows a commit. */
function DecisionField({
  label,
  schema,
  value,
  disabled,
  onCommit,
  inline = false,
  placeholder,
}: {
  label: string
  inline?: boolean
  placeholder?: string
  schema: JsonValue
  value: string
  disabled: boolean
  onCommit: (value: string) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const current = useRef(draft)
  const saved = useRef(value)
  const request = useRef<AbortController>()
  const [invalid, setInvalid] = useState(false)
  const t = useTranslate()
  useEffect(() => {
    if (dequal(saved.current, value)) return
    saved.current = value
    request.current?.abort()
    current.current = value
    setDraft(value)
    setInvalid(false)
  }, [value])
  useEffect(() => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const candidate = current.current
    void Promise.resolve().then(() => {
      if (controller.signal.aborted || current.current !== candidate) return
      setInvalid(!matchesSchema(candidate, schema))
    })
    return () => controller.abort()
  }, [schema, disabled, value])
  useEffect(() => () => request.current?.abort(), [])
  async function commit() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const candidate = current.current
    await Promise.resolve()
    if (controller.signal.aborted) return
    const valid = matchesSchema(candidate, schema)
    if (controller.signal.aborted || current.current !== candidate) return
    setInvalid(!valid)
    if (valid && !disabled && !dequal(candidate, value)) onCommit(candidate)
  }
  const change = (next: string) => {
    request.current?.abort()
    current.current = next
    setDraft(next)
    setInvalid(false)
  }
  const multiline = (schema as Record<string, JsonValue>)['ui:widget'] === 'text'
  return (
    <Field
      className="gap-1.5"
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) void commit()
      }}
    >
      {!inline && (
        <FieldLabel className="text-xs font-normal leading-4" htmlFor={id}>
          {label}
        </FieldLabel>
      )}
      <ValueEditorFeedback error={invalid ? t('decision.invalidValue') : undefined}>
        {(errorId) =>
          multiline ? (
            <Textarea
              id={id}
              rows={2}
              placeholder={placeholder}
              aria-label={label}
              aria-describedby={errorId}
              aria-invalid={invalid}
              readOnly={disabled}
              value={draft}
              onChange={(event) => change(event.target.value)}
            />
          ) : (
            <Input
              id={id}
              controlSize="field"
              placeholder={placeholder}
              aria-label={label}
              aria-describedby={errorId}
              aria-invalid={invalid}
              readOnly={disabled}
              value={draft}
              onChange={(event) => change(event.target.value)}
            />
          )
        }
      </ValueEditorFeedback>
    </Field>
  )
}

export function DecisionSection({
  task,
  disabled,
  onSave,
}: {
  task: ManagedTaskDefinition
  disabled: boolean
  onSave: (before: ManagedTaskDefinition, next: ManagedTaskDefinition, deletion?: PropertyDeletion) => Promise<boolean>
}) {
  const t = useTranslate()
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const taskRef = useRef(task)
  taskRef.current = task
  const [changes] = useState(
    () =>
      new TaskExecutorChanges<PropertyDeletion>(task.executor, async (before, next, deletion) => {
        if (before.kind !== 'decision' || next.kind !== 'decision') return false
        return saveRef.current(
          dequal(before, taskRef.current.executor) ? taskRef.current : decisionTask(before.questions, taskRef.current.name),
          decisionTask(next.questions, taskRef.current.name),
          deletion,
        )
      }),
  )
  const [config, setConfig] = useState(changes.value)
  const [saveError, setSaveError] = useState(false)
  const questionId = useId()
  const [open, setOpen] = useState<ReadonlySet<number>>(
    () =>
      new Set(config.kind === 'decision' ? decisionQuestionIssues(config.questions).flatMap((issue) => (issue.question == null ? [] : [issue.question])) : []),
  )
  useEffect(() => {
    changes.sync(task.executor)
    setConfig(changes.value)
  }, [changes, task.executor])
  if (config.kind !== 'decision') return null
  const questions = limitDecisionQuestions(config.questions)
  async function update(next: readonly DecisionQuestion[], removed?: PropertyDeletion) {
    if (disabled) return
    changes.value = { kind: 'decision', questions: next }
    setConfig(changes.value)
    try {
      setSaveError(!(await changes.save(removed)))
    } catch {
      setSaveError(true)
    }
  }
  function edit(index: number, question: DecisionQuestion, removed?: PropertyDeletion) {
    if (changes.value.kind !== 'decision') return
    void update(
      limitDecisionQuestions(changes.value.questions).map((item, i) => (i === index ? question : item)),
      removed,
    )
  }
  function add(after = questions.length - 1) {
    let name = defaultDecisionQuestion().name
    let suffix = 2
    while (questions.some((question) => question.name === name)) name = `decision${suffix++}`
    const index = after + 1
    setOpen(new Set([...open].map((i) => (i >= index ? i + 1 : i)).concat(index)))
    void update(questions.toSpliced(index, 0, defaultDecisionQuestion(name)))
  }
  return (
    <InspectorSection title={t('decision.questions')} contentInset={false} data-inspector-section="task">
      <FieldTable layout="ports" output actionSlots={2} empty={!questions.length}>
        <ArrayFieldList values={questions} label={t('decision.questions')}>
          {(_entry, index) => {
            const question = questions[index]!
            const bodyId = `${questionId}-${index}`
            return (
              <FieldRow
                stacking="fields"
                label={question.name}
                data-output
                data-object-child
                data-expansion="branch"
                disclosure={{
                  controls: question.type === 'noul' ? bodyId : `${bodyId} ${bodyId}-criteria`,
                  expanded: open.has(index),
                  onToggle: () =>
                    setOpen((previous) => {
                      const next = new Set(previous)
                      if (next.has(index)) next.delete(index)
                      else next.add(index)
                      return next
                    }),
                }}
                header={
                  <>
                    <FieldName name={question.name}>
                      <DecisionField
                        inline
                        label={t('decision.name')}
                        schema={nameSchema(questions.filter((_, i) => i !== index).map((item) => item.name))}
                        value={question.name}
                        disabled={disabled}
                        onCommit={(name) => edit(index, { ...question, name })}
                      />
                    </FieldName>
                    <div data-field-type>
                      <FieldSelect
                        aria-label={`${question.name} ${t('decision.type')}`}
                        value={question.type}
                        disabled={disabled}
                        readOnly={disabled}
                        onChange={(type) => {
                          setOpen((previous) => new Set(previous).add(index))
                          const base = { name: question.name, instructions: question.instructions }
                          if (type === 'noul') edit(index, { ...base, type })
                          if (type === 'choice') edit(index, { ...base, type, criteria: [] })
                          if (type === 'score') edit(index, { ...base, type, criteria: ['', ''] })
                        }}
                      >
                        {(['noul', 'choice', 'score'] as const).map((type) => (
                          <option key={type} value={type}>
                            {t(`decision.${type}`)}
                          </option>
                        ))}
                      </FieldSelect>
                    </div>
                  </>
                }
                actions={
                  !disabled && (
                    <DecisionItemActions
                      addLabel={t('decision.addQuestion')}
                      removeLabel={t('decision.removeQuestion')}
                      onAdd={() => add(index)}
                      onRemove={() => {
                        setOpen(new Set([...open].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))))
                        void update(
                          questions.filter((_, i) => i !== index),
                          { target: 'field', name: question.name },
                        )
                      }}
                    />
                  )
                }
              >
                <FieldBody id={bodyId} placement="branch" className={fieldStyles.body} hidden={!open.has(index)}>
                  <FieldGroup className={question.type === 'noul' ? 'gap-0' : 'gap-3'}>
                    <DecisionField
                      inline
                      placeholder={t('decision.instructionsPlaceholder')}
                      label={t('decision.instructions')}
                      schema={instructionSchema}
                      value={question.instructions}
                      disabled={disabled}
                      onCommit={(instructions) => edit(index, { ...question, instructions })}
                    />
                    {question.type === 'noul' ? (
                      <DecisionNoulCriteria question={question} disabled={disabled} onChange={(criteria) => edit(index, { ...question, criteria })} />
                    ) : question.type === 'score' ? (
                      <Field className="gap-1.5">
                        <div className="flex items-center gap-1">
                          <FieldLabel className="text-xs font-normal leading-4">{t('decision.levels')}</FieldLabel>
                          <DecisionLevelsHelp />
                        </div>
                      </Field>
                    ) : null}
                  </FieldGroup>
                </FieldBody>
                {question.type !== 'noul' && (
                  <div id={`${bodyId}-criteria`} className="col-span-full" hidden={!open.has(index)}>
                    <FieldLayout layout="ports" depth={1}>
                      {question.type === 'choice' ? (
                        <DecisionChoices
                          question={question}
                          disabled={disabled}
                          onChange={(criteria, removed) => edit(index, { ...question, criteria }, removed)}
                        />
                      ) : (
                        <DecisionLevels
                          levels={question.criteria}
                          disabled={disabled}
                          onChange={(criteria, removed) => edit(index, { ...question, criteria }, removed)}
                        />
                      )}
                    </FieldLayout>
                  </div>
                )}
              </FieldRow>
            )
          }}
        </ArrayFieldList>
        {!questions.length && (
          <div className={`${fieldStyles.collectionActions} pb-4`} data-layout="ports">
            <Button type="button" variant="ghost" size="field" className={fieldStyles.emptyObjectContent} disabled={disabled} onClick={() => add()}>
              <i aria-hidden="true" className="i-lucide-light:plus" />
              {t('decision.addQuestion')}
            </Button>
          </div>
        )}
      </FieldTable>
      {saveError && <FieldError className="px-3 pb-4">{t('decision.saveFailed')}</FieldError>}
    </InspectorSection>
  )
}

type NoulQuestion = Extract<DecisionQuestion, { type: 'noul' }>
function DecisionNoulCriteria({
  question,
  disabled,
  onChange,
}: {
  question: NoulQuestion
  disabled: boolean
  onChange: (criteria: NoulQuestion['criteria']) => void
}) {
  const t = useTranslate()
  const id = useId()
  const count = (['true', 'false'] as const).filter((key) => question.criteria?.[key]?.trim()).length
  const [open, setOpen] = useState(() => count > 0)
  return (
    <Field className="gap-2">
      <Button
        type="button"
        variant="disclosure"
        size="field"
        className="justify-start px-0"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <i aria-hidden="true" className={open ? 'i-lucide-light:chevron-down' : 'i-lucide-light:chevron-right'} />
        {t('decision.criteria')}
        {!open && count > 0 && <span className="ml-auto text-muted-foreground">{t('decision.criteriaSet', { count })}</span>}
      </Button>
      <div id={id} hidden={!open}>
        <FieldGroup className="gap-3">
          {(['true', 'false'] as const).map((key) => (
            <DecisionField
              key={key}
              label={t(`decision.${key}`)}
              schema={{ 'type': 'string', 'ui:widget': 'text' }}
              value={question.criteria?.[key] ?? ''}
              disabled={disabled}
              onCommit={(value) => onChange({ ...question.criteria, [key]: value })}
            />
          ))}
        </FieldGroup>
      </div>
    </Field>
  )
}

type ChoiceQuestion = Extract<DecisionQuestion, { type: 'choice' }>
function DecisionChoices({
  question,
  disabled,
  onChange,
}: {
  question: ChoiceQuestion
  disabled: boolean
  onChange: (criteria: ChoiceQuestion['criteria'], removed?: PropertyDeletion) => void
}) {
  const t = useTranslate()
  const choices = question.criteria
  const added = useRef(new WeakSet<ChoiceQuestion['criteria'][number]>())
  function add(after: number) {
    if (choices.length >= decisionLimits.choice) return
    let name = 'category1'
    let suffix = 2
    while (choices.some((choice) => choice.name === name)) name = `category${suffix++}`
    const choice = { name, description: '' }
    added.current.add(choice)
    onChange(choices.toSpliced(after + 1, 0, choice))
  }
  return (
    <div>
      <ArrayFieldList values={choices} label={t('decision.choices')}>
        {(_entry, index) => {
          const choice = choices[index]!
          const names = choices.filter((_, i) => i !== index).map((item) => item.name)
          return (
            <DecisionChoice
              choice={choice}
              names={names}
              disabled={disabled}
              canAdd={choices.length < decisionLimits.choice}
              initiallyOpen={added.current.has(choice) || !matchesSchema(choice.name, nameSchema(names))}
              onAdd={() => add(index)}
              onRemove={() => onChange(choices.toSpliced(index, 1), { target: 'arrayItem', name: choices[index]!.name })}
              onChange={(updated) => onChange(choices.map((item, i) => (i === index ? updated : item)))}
            />
          )
        }}
      </ArrayFieldList>
      {!choices.length && (
        <div className={fieldStyles.collectionActions} data-layout="ports">
          <Button type="button" variant="ghost" size="field" className={fieldStyles.emptyObjectContent} disabled={disabled} onClick={() => add(-1)}>
            <i aria-hidden="true" className="i-lucide-light:plus" />
            {t('decision.addChoice')}
          </Button>
        </div>
      )}
    </div>
  )
}
function DecisionChoice({
  choice,
  names,
  disabled,
  canAdd,
  initiallyOpen,
  onAdd,
  onRemove,
  onChange,
}: {
  choice: ChoiceQuestion['criteria'][number]
  names: readonly string[]
  disabled: boolean
  canAdd: boolean
  initiallyOpen: boolean
  onAdd: () => void
  onRemove: () => void
  onChange: (choice: ChoiceQuestion['criteria'][number]) => void
}) {
  const t = useTranslate()
  const id = useId()
  const [open, setOpen] = useState(initiallyOpen)
  const row = useRef<HTMLDivElement>(null)
  const focusDescription = useRef(false)
  useEffect(() => {
    if (!open || !focusDescription.current) return
    focusDescription.current = false
    row.current?.querySelector('textarea')?.focus()
  }, [open])
  return (
    <FieldRow
      ref={row}
      stacking="fields"
      label={choice.name}
      layout="ports"
      data-output
      data-object-child
      data-expansion="branch"
      data-expanded={open || undefined}
      disclosure={{ controls: id, expanded: open, onToggle: () => setOpen(!open) }}
      header={
        <span data-field-name>
          <DecisionField
            inline
            label={t('decision.choiceName')}
            placeholder={t('decision.choiceName')}
            schema={nameSchema(names)}
            value={choice.name}
            disabled={disabled}
            onCommit={(name) => onChange({ ...choice, name })}
          />
        </span>
      }
      actions={
        !disabled && (
          <DecisionItemActions addLabel={t('decision.addChoice')} removeLabel={t('decision.removeChoice')} canAdd={canAdd} onAdd={onAdd} onRemove={onRemove} />
        )
      }
    >
      <FieldValuePreview
        style={{ gridColumn: 'type / content-end', gridRow: 1 }}
        empty={!choice.description}
        data-readonly={disabled || undefined}
        aria-label={t('decision.choiceDescription')}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          focusDescription.current = !open
          setOpen(!open)
        }}
      >
        {choice.description || t('decision.choiceDescription')}
      </FieldValuePreview>
      <FieldBody id={id} placement="branch" className={fieldStyles.body} hidden={!open}>
        <DecisionField
          inline
          label={t('decision.choiceDescription')}
          placeholder={t('decision.choiceDescription')}
          schema={{ 'type': 'string', 'ui:widget': 'text' }}
          value={choice.description}
          disabled={disabled}
          onCommit={(description) => onChange({ ...choice, description })}
        />
      </FieldBody>
    </FieldRow>
  )
}

function DecisionLevelsHelp() {
  const t = useTranslate()
  const id = useId()
  const [tooltip] = useState(() => createTooltipHandle())
  return (
    <Tooltip handle={tooltip}>
      <TooltipTrigger
        id={id}
        handle={tooltip}
        closeOnClick={false}
        onClick={() => tooltip.open(id)}
        render={<Button type="button" variant="ghost" size="icon-xs" aria-label={t('decision.levels')} />}
      >
        <i aria-hidden="true" className="i-lucide-light:circle-help text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent>
        {t('decision.levelsCount')} {t('decision.levelsHint')}
      </TooltipContent>
    </Tooltip>
  )
}

function DecisionLevels({
  levels,
  disabled,
  onChange,
}: {
  levels: readonly string[]
  disabled: boolean
  onChange: (levels: readonly string[], removed?: PropertyDeletion) => void
}) {
  const t = useTranslate()
  return (
    <div>
      <ArrayFieldList values={levels} label={t('decision.levels')}>
        {(_entry, index) => (
          <DecisionLevel
            value={levels[index]!}
            index={index}
            disabled={disabled}
            canAdd={levels.length < decisionLimits.score}
            onAdd={() => {
              if (levels.length < decisionLimits.score) onChange(levels.toSpliced(index + 1, 0, ''))
            }}
            onRemove={() => onChange(levels.toSpliced(index, 1), { target: 'arrayItem', name: String(index) })}
            onChange={(value) => onChange(levels.map((level, i) => (i === index ? value : level)))}
          />
        )}
      </ArrayFieldList>
      {levels.length < 2 && (
        <div className={`${fieldStyles.collectionActions} ${levels.length ? 'mt-2' : ''}`} data-layout="ports">
          <ValueEditorFeedback error={t('decision.levelsCount')}>
            {(errorId) => (
              <Button
                type="button"
                variant="ghost"
                size="field"
                className={fieldStyles.emptyObjectContent}
                data-field-prompt="true"
                aria-invalid="true"
                aria-describedby={errorId}
                disabled={disabled}
                onClick={() => onChange([...levels, ...Array<string>(2 - levels.length).fill('')])}
              >
                <i aria-hidden="true" className="i-lucide-light:plus" />
                {t('decision.addLevel')}
              </Button>
            )}
          </ValueEditorFeedback>
        </div>
      )}
    </div>
  )
}

function DecisionLevel({
  value,
  index,
  disabled,
  canAdd,
  onAdd,
  onRemove,
  onChange,
}: {
  value: string
  index: number
  disabled: boolean
  canAdd: boolean
  onAdd: () => void
  onRemove: () => void
  onChange: (value: string) => void
}) {
  const t = useTranslate()
  const label = t('decision.levelNumber', { level: index })
  return (
    <FieldRow
      stacking="fields"
      label={label}
      layout="ports"
      columns="[toggle] var(--field-toggle-width, 20px) var(--field-value-name-gap, 2px) [handle] max-content 8px [type] minmax(0, 1fr) [content-end] var(--field-table-actions-gap, 4px) [nullable actions] var(--field-actions-width, 28px) [end]"
      data-output
      data-object-child
      header={
        <span data-field-name className="flex items-center text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {label}
        </span>
      }
      actions={
        !disabled && (
          <DecisionItemActions addLabel={t('decision.addLevel')} removeLabel={t('decision.removeLevel')} canAdd={canAdd} onAdd={onAdd} onRemove={onRemove} />
        )
      }
    >
      <div style={{ gridColumn: 'type / content-end', gridRow: 1 }}>
        <DecisionField
          inline
          label={`${label} ${t('decision.levelDescription')}`}
          placeholder={t('decision.levelPlaceholder')}
          schema={textSchema}
          value={value}
          disabled={disabled}
          onCommit={(description) => onChange(description)}
        />
      </div>
    </FieldRow>
  )
}

function DecisionItemActions({
  addLabel,
  removeLabel,
  canAdd = true,
  onAdd,
  onRemove,
}: {
  addLabel: string
  removeLabel: string
  canAdd?: boolean
  onAdd: () => void
  onRemove: () => void
}) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={addLabel} disabled={!canAdd} onClick={onAdd} />}>
          <i aria-hidden="true" className="i-tabler-light:square-rounded-plus text-lg" />
        </TooltipTrigger>
        <TooltipContent>{addLabel}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={<Button type="button" variant="ghost" size="icon-xs" className="-translate-x-0.5" aria-label={removeLabel} onClick={onRemove} />}
        >
          <i aria-hidden="true" className="i-tabler-light:square-rounded-minus text-lg" />
        </TooltipTrigger>
        <TooltipContent>{removeLabel}</TooltipContent>
      </Tooltip>
    </>
  )
}
