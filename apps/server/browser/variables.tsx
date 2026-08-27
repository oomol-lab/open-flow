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
    } catch (error) {
      if (sequence != loadSequence.current) return
      setFailed(true)
      toast.error(error instanceof Error ? error.message : t('variables.loadFailed'))
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('variables.loadFailed'))
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('variables.loadFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="variables-page">
      <div className="variables-content">
        <header className="variables-header">
          <div>
            <span>Open Flow Server</span>
            <h1>{t('variables.title')}</h1>
            <p>{t('variables.description')}</p>
          </div>
        </header>
        <section className="variables-section" aria-labelledby="variables-title">
          <div className="variables-toolbar">
            <div className="variables-heading">
              <h2 id="variables-title">{t('variables.all')}</h2>
              <span>{t('variables.count', { count: variables.length })}</span>
            </div>
            <div className="variables-actions">
              <input
                aria-label={t('variables.search')}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t('variables.search')}
                type="search"
                value={filter}
              />
              <button disabled={loading || pending} onClick={() => void load()} type="button">
                {t('variables.refresh')}
              </button>
              <button
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
            </div>
          </div>
          {editing != null && (
            <form className="variable-form" onSubmit={(event) => void save(event)}>
              <label htmlFor="variable-name">{t('variables.name')}</label>
              <input
                autoFocus
                disabled={editing != ''}
                id="variable-name"
                maxLength={256}
                onChange={(event) => setName(event.target.value)}
                value={editing == '' ? name : editing}
              />
              {nameInvalid && name != '' && <span className="variable-error">{t('variables.invalidName')}</span>}
              <label htmlFor="variable-value">{t('variables.value')}</label>
              <textarea id="variable-value" onChange={(event) => setValue(event.target.value)} rows={6} value={value} />
              {valueTooLarge && <span className="variable-error">{t('variables.valueTooLarge')}</span>}
              <div className="variable-form-actions">
                <button disabled={pending} onClick={() => setEditing(undefined)} type="button">
                  {t('variables.cancel')}
                </button>
                <button disabled={pending || nameInvalid || valueTooLarge} type="submit">
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
              <p className="variables-state">{t('variables.refresh')}…</p>
            ) : failed ? (
              <div className="variables-state" role="alert">
                <p>{t('variables.loadFailed')}</p>
                <button onClick={() => void load()} type="button">
                  {t('variables.retry')}
                </button>
              </div>
            ) : visible.length == 0 ? (
              <p className="variables-state">{t(filter.trim() == '' ? 'variables.empty' : 'variables.noMatch')}</p>
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
                        <button disabled={pending} onClick={() => setRemoving(undefined)} type="button">
                          {t('variables.cancel')}
                        </button>
                        <button disabled={pending} onClick={() => void remove(variable.name)} type="button">
                          {t('variables.delete')}
                        </button>
                      </span>
                    ) : (
                      <>
                        <button
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
                        <button disabled={pending} onClick={() => setRemoving(variable.name)} type="button">
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
