import type { Variable } from '@oomol-lab/open-flow/control-api'
import type { WorkbenchLanguage } from '@oomol-lab/open-flow/workbench'
import type { FormEvent, ReactElement } from 'react'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { validVariableName } from '@oomol-lab/open-flow/flow-change'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  Textarea,
} from '@oomol-lab/open-flow/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from 'val-i18n-react'
import { posthog } from './posthog.ts'

const maxCount = 200
const maxValueBytes = 64 * 1024

interface VariableEditor {
  readonly kind: 'create' | 'edit'
  readonly name: string
  readonly value: string
}

export function VariablesPage({ client, language }: { readonly client: ControlClient; readonly language: WorkbenchLanguage }): ReactElement {
  const t = useTranslate()
  const [variables, setVariables] = useState<readonly Variable[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const [filter, setFilter] = useState('')
  const [editor, setEditor] = useState<VariableEditor>()
  const [removing, setRemoving] = useState<string>()
  const loadSequence = useRef(0)
  const portal = useRef<HTMLElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const valueInput = useRef<HTMLTextAreaElement>(null)
  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setFailed(false)
    try {
      const result = await client.listVariables()
      if (sequence != loadSequence.current) return
      setVariables(result.variables)
    } catch {
      if (sequence != loadSequence.current) return
      setFailed(true)
      toast.error(t('variables.loadFailed'))
    } finally {
      if (sequence == loadSequence.current) setLoading(false)
    }
  }, [client, t])

  useEffect(() => {
    void load()
    const refresh = (): void => void load()
    globalThis.addEventListener('focus', refresh)
    return () => {
      loadSequence.current += 1
      globalThis.removeEventListener('focus', refresh)
    }
  }, [load])

  const visible = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return query == '' ? variables : variables.filter((variable) => variable.name.toLocaleLowerCase().includes(query))
  }, [filter, variables])
  const valueTooLarge = editor != null && new TextEncoder().encode(editor.value).byteLength > maxValueBytes
  const nameExists = editor?.kind == 'create' && variables.some((variable) => variable.name == editor.name)
  const nameInvalid = editor?.kind == 'create' && (!validVariableName(editor.name) || nameExists)

  function createVariable(): void {
    setEditor({ kind: 'create', name: '', value: '' })
    setRemoving(undefined)
  }

  function editVariable(variable: Variable): void {
    setEditor({ kind: 'edit', name: variable.name, value: variable.value })
    setRemoving(undefined)
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (editor == null || !validVariableName(editor.name) || nameExists || valueTooLarge || loading || failed || pending) return
    setPending(true)
    try {
      await client.putVariable(editor.name, editor.value)
      posthog?.capture(editor.kind == 'create' ? 'variable_created' : 'variable_updated')
      await load()
      setEditor(undefined)
    } catch {
      toast.error(t('variables.saveFailed'))
    } finally {
      setPending(false)
    }
  }

  async function remove(variableName: string): Promise<void> {
    if (pending) return
    setPending(true)
    try {
      await client.deleteVariable(variableName)
      posthog?.capture('variable_deleted')
      await load()
      setRemoving(undefined)
      if (editor?.name == variableName) setEditor(undefined)
    } catch {
      toast.error(t('variables.deleteFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <main ref={portal} className="variables-page">
      <div className="variables-content">
        <section aria-busy={loading || pending} aria-labelledby="variables-title" className="variables-section rounded-lg">
          <div className="variables-toolbar">
            <div className="variables-heading">
              <h1 id="variables-title">{t('variables.title')}</h1>
              <span>{t('variables.count', { count: variables.length })}</span>
            </div>
            <div className="variables-actions">
              <InputGroup className="variable-search">
                <InputGroupAddon>
                  <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="6" />
                    <path d="m16 16 4 4" />
                  </svg>
                </InputGroupAddon>
                <InputGroupInput
                  aria-label={t('variables.search')}
                  autoComplete="off"
                  name="variable-search"
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t('variables.search')}
                  type="search"
                  value={filter}
                />
              </InputGroup>
              <Button
                className="pr-3"
                variant="default"
                size="default"
                disabled={loading || failed || pending || variables.length >= maxCount}
                onClick={createVariable}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  data-icon="inline-start"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  viewBox="0 0 24 24"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {t('variables.create')}
              </Button>
            </div>
          </div>
          <div className="variable-columns" aria-hidden="true">
            <span>{t('variables.name')}</span>
            <span>{t('variables.value')}</span>
            <span>{t('variables.updated')}</span>
            <span />
          </div>
          <div className="variable-list">
            {loading ? (
              Array.from({ length: 5 }, (_, index) => (
                <div aria-hidden="true" className="variable-row variable-skeleton-row" key={index}>
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              ))
            ) : failed ? (
              <div className="variables-state" role="alert">
                <span aria-hidden="true" className="variables-state-icon">
                  <i className="i-lucide-light:triangle-alert size-4" />
                </span>
                <strong>{t('variables.loadFailed')}</strong>
                <span>{t('variables.description')}</span>
                <Button variant="outline" size="default" onClick={() => void load()} type="button">
                  {t('variables.retry')}
                </Button>
              </div>
            ) : visible.length == 0 ? (
              <div className="variables-state">
                <span aria-hidden="true" className="variables-state-icon">
                  <i className="i-lucide-light:sliders-horizontal size-4" />
                </span>
                <strong>{t(filter.trim() == '' ? 'variables.empty' : 'variables.noMatch')}</strong>
                <span>{t('variables.description')}</span>
                {filter.trim() == '' && (
                  <Button variant="outline" size="default" disabled={pending || variables.length >= maxCount} onClick={createVariable} type="button">
                    {t('variables.create')}
                  </Button>
                )}
              </div>
            ) : (
              visible.map((variable) => (
                <div className="variable-row" key={variable.name}>
                  <strong>{variable.name}</strong>
                  <code>{variable.value}</code>
                  <time dateTime={variable.updatedAt}>{new Date(variable.updatedAt).toLocaleString(language)}</time>
                  <div>
                    {removing == variable.name ? (
                      <span className="variable-confirm">
                        {t('variables.deleteConfirm', { name: variable.name })}
                        <Button variant="outline" size="sm" disabled={pending} onClick={() => setRemoving(undefined)} type="button">
                          {t('variables.cancel')}
                        </Button>
                        <Button variant="destructive" size="sm" disabled={pending} onClick={() => void remove(variable.name)} type="button">
                          {t('variables.delete')}
                        </Button>
                      </span>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" disabled={pending} onClick={() => editVariable(variable)} type="button">
                          {t('variables.edit')}
                        </Button>
                        <Button variant="destructive" size="sm" disabled={pending} onClick={() => setRemoving(variable.name)} type="button">
                          {t('variables.delete')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
        <Dialog
          onOpenChange={(open) => {
            if (!open && !pending) setEditor(undefined)
          }}
          open={editor != null}
        >
          <DialogContent
            closeLabel={t('variables.cancel')}
            container={portal.current}
            initialFocus={() => (editor?.kind == 'create' ? nameInput.current : valueInput.current)}
          >
            <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
              <DialogHeader>
                <DialogTitle>
                  {editor?.kind == 'create' ? t('variables.create') : t('variables.edit')}
                  {editor?.kind == 'edit' && <span className="ml-2">{editor.name}</span>}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="variable-name">{t('variables.name')}</Label>
                <Input
                  aria-describedby={nameInvalid && editor?.name != '' ? 'variable-name-error' : undefined}
                  aria-invalid={nameInvalid && editor?.name != ''}
                  autoComplete="off"
                  id="variable-name"
                  maxLength={256}
                  name="variable-name"
                  onChange={(event) => setEditor((current) => (current == null ? current : { ...current, name: event.target.value }))}
                  readOnly={editor?.kind == 'edit'}
                  ref={nameInput}
                  spellCheck={false}
                  value={editor?.name ?? ''}
                />
                {nameInvalid && editor?.name != '' && (
                  <span className="variable-error" id="variable-name-error">
                    {t(nameExists ? 'variables.nameExists' : 'variables.invalidName')}
                  </span>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="variable-value">{t('variables.value')}</Label>
                <Textarea
                  aria-describedby={valueTooLarge ? 'variable-value-error' : undefined}
                  aria-invalid={valueTooLarge}
                  autoComplete="off"
                  id="variable-value"
                  name="variable-value"
                  onChange={(event) => setEditor((current) => (current == null ? current : { ...current, value: event.target.value }))}
                  ref={valueInput}
                  rows={6}
                  spellCheck={false}
                  value={editor?.value ?? ''}
                />
                {valueTooLarge && (
                  <span className="variable-error" id="variable-value-error">
                    {t('variables.valueTooLarge')}
                  </span>
                )}
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />} disabled={pending} type="button">
                  {t('variables.cancel')}
                </DialogClose>
                <Button variant="default" size="default" disabled={loading || failed || pending || nameInvalid || valueTooLarge} type="submit">
                  {t('variables.save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  )
}
