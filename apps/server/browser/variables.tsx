import type { Variable } from '@oomol-lab/open-flow/control-api'
import type { WorkbenchLanguage } from '@oomol-lab/open-flow/workbench'
import type { FormEvent, ReactElement } from 'react'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { validVariableName } from '@oomol-lab/open-flow/flow-change'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from 'val-i18n-react'

const maxCount = 200
const maxValueBytes = 64 * 1024

export function VariablesPage({ client, language }: { readonly client: ControlClient; readonly language: WorkbenchLanguage }): ReactElement {
  const t = useTranslate()
  const [variables, setVariables] = useState<readonly Variable[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<string>()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [removing, setRemoving] = useState<string>()
  const loadSequence = useRef(0)
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
  const valueTooLarge = new TextEncoder().encode(value).byteLength > maxValueBytes
  const nameInvalid = editing == '' && !validVariableName(name)

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    const target = editing == '' ? name : editing
    if (target == null || !validVariableName(target) || valueTooLarge || pending) return
    setPending(true)
    try {
      await client.putVariable(target, value)
      await load()
      setEditing(undefined)
      setName('')
      setValue('')
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
      await load()
      setRemoving(undefined)
      if (editing == variableName) setEditing(undefined)
    } catch {
      toast.error(t('variables.deleteFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="variables-page">
      <div className="variables-content">
        <header className="variables-header">
          <h1>{t('variables.title')}</h1>
        </header>
        <section aria-busy={loading || pending} aria-labelledby="variables-title" className="variables-section">
          <div className="variables-toolbar">
            <div className="variables-heading">
              <h2 id="variables-title">{t('variables.all')}</h2>
              <span>{t('variables.count', { count: variables.length })}</span>
            </div>
            <div className="variables-actions">
              <div className="server-input-group">
                <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="6" />
                  <path d="m16 16 4 4" />
                </svg>
                <input
                  aria-label={t('variables.search')}
                  autoComplete="off"
                  name="variable-search"
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t('variables.search')}
                  type="search"
                  value={filter}
                />
              </div>
              <button
                aria-label={t('variables.refresh')}
                className="server-button server-button-icon server-button-outline"
                disabled={loading || pending}
                onClick={() => void load()}
                title={t('variables.refresh')}
                type="button"
              >
                <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                  <path d="M20 6v5h-5" />
                  <path d="M4 18v-5h5" />
                  <path d="M6.1 9a7 7 0 0 1 11.7-2.6L20 11M4 13l2.2 4.6A7 7 0 0 0 17.9 15" />
                </svg>
              </button>
              <button
                className="server-button server-button-primary"
                disabled={pending || variables.length >= maxCount}
                onClick={() => {
                  setEditing('')
                  setName('')
                  setValue('')
                  setRemoving(undefined)
                }}
                type="button"
              >
                <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {t('variables.create')}
              </button>
            </div>
          </div>
          {editing != null && (
            <form className="variable-form" onSubmit={(event) => void save(event)}>
              <label htmlFor="variable-name">{t('variables.name')}</label>
              <input
                aria-describedby={nameInvalid && name != '' ? 'variable-name-error' : undefined}
                aria-invalid={nameInvalid && name != ''}
                autoComplete="off"
                disabled={editing != ''}
                id="variable-name"
                maxLength={256}
                name="variable-name"
                onChange={(event) => setName(event.target.value)}
                spellCheck={false}
                value={editing == '' ? name : editing}
              />
              {nameInvalid && name != '' && (
                <span className="variable-error" id="variable-name-error">
                  {t('variables.invalidName')}
                </span>
              )}
              <label htmlFor="variable-value">{t('variables.value')}</label>
              <textarea
                aria-describedby={valueTooLarge ? 'variable-value-error' : undefined}
                aria-invalid={valueTooLarge}
                autoComplete="off"
                id="variable-value"
                name="variable-value"
                onChange={(event) => setValue(event.target.value)}
                rows={6}
                spellCheck={false}
                value={value}
              />
              {valueTooLarge && (
                <span className="variable-error" id="variable-value-error">
                  {t('variables.valueTooLarge')}
                </span>
              )}
              <div className="variable-form-actions">
                <button className="server-button server-button-outline" disabled={pending} onClick={() => setEditing(undefined)} type="button">
                  {t('variables.cancel')}
                </button>
                <button className="server-button server-button-primary" disabled={pending || nameInvalid || valueTooLarge} type="submit">
                  {t('variables.save')}
                </button>
              </div>
            </form>
          )}
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
                  !
                </span>
                <strong>{t('variables.loadFailed')}</strong>
                <span>{t('variables.description')}</span>
                <button className="server-button server-button-outline" onClick={() => void load()} type="button">
                  {t('variables.retry')}
                </button>
              </div>
            ) : visible.length == 0 ? (
              <div className="variables-state">
                <span aria-hidden="true" className="variables-state-icon">
                  V
                </span>
                <strong>{t(filter.trim() == '' ? 'variables.empty' : 'variables.noMatch')}</strong>
                <span>{t('variables.description')}</span>
                {filter.trim() == '' && (
                  <button
                    className="server-button server-button-outline"
                    disabled={pending || variables.length >= maxCount}
                    onClick={() => {
                      setEditing('')
                      setName('')
                      setValue('')
                      setRemoving(undefined)
                    }}
                    type="button"
                  >
                    {t('variables.create')}
                  </button>
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
                        <button
                          className="server-button server-button-sm server-button-outline"
                          disabled={pending}
                          onClick={() => setRemoving(undefined)}
                          type="button"
                        >
                          {t('variables.cancel')}
                        </button>
                        <button
                          className="server-button server-button-destructive server-button-sm"
                          disabled={pending}
                          onClick={() => void remove(variable.name)}
                          type="button"
                        >
                          {t('variables.delete')}
                        </button>
                      </span>
                    ) : (
                      <>
                        <button
                          className="server-button server-button-outline server-button-sm"
                          disabled={pending}
                          onClick={() => {
                            setEditing(variable.name)
                            setName(variable.name)
                            setValue(variable.value)
                            setRemoving(undefined)
                          }}
                          type="button"
                        >
                          {t('variables.edit')}
                        </button>
                        <button
                          className="server-button server-button-destructive server-button-sm"
                          disabled={pending}
                          onClick={() => setRemoving(variable.name)}
                          type="button"
                        >
                          {t('variables.delete')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
