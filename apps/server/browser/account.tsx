import type { FormEvent, ReactElement } from 'react'
import type { SessionUser, UserToken } from '../common/users.ts'

import { mcpProtocolVersion } from '@oomol-lab/open-flow/mcp'
import { Button, Input, Label } from '@oomol-lab/open-flow/ui'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from 'val-i18n-react'
import { z } from 'zod'

const tokenSchema = z.object({ tokenId: z.string().min(1), name: z.string().min(1), createdAt: z.number().int() })
const listSchema = z.object({ version: z.literal(1), tokens: z.array(tokenSchema) })
const createdSchema = z.object({ version: z.literal(1), credential: tokenSchema, token: z.string().min(1) })

function McpInformation({ personal }: { readonly personal: boolean }): ReactElement {
  const t = useTranslate()
  const endpoint = new URL('/v1/mcp', window.location.origin).href

  async function copyAddress(): Promise<void> {
    try {
      await navigator.clipboard.writeText(endpoint)
      toast.success(t('settings.mcpCopied'))
    } catch {
      toast.error(t('settings.mcpCopyFailed'))
    }
  }

  return (
    <section className="settings-section" aria-labelledby="settings-mcp-title">
      <div className="settings-heading">
        <div className="settings-heading-copy">
          <h2 id="settings-mcp-title">MCP</h2>
          <p>{t('settings.mcpDescription')}</p>
        </div>
      </div>
      <div className="settings-form">
        <Label htmlFor="settings-mcp-endpoint">{t('settings.mcpAddress')}</Label>
        <div className="settings-mcp-address">
          <Input id="settings-mcp-endpoint" readOnly value={endpoint} />
          <Button variant="outline" size="sm" type="button" onClick={() => void copyAddress()}>
            {t('settings.mcpCopy')}
          </Button>
        </div>
        <dl className="settings-mcp-details">
          <div>
            <dt>{t('settings.mcpTransport')}</dt>
            <dd>Streamable HTTP</dd>
          </div>
          <div>
            <dt>{t('settings.mcpProtocol')}</dt>
            <dd>{mcpProtocolVersion}</dd>
          </div>
          <div>
            <dt>{t('settings.mcpAuthentication')}</dt>
            <dd>
              <code>Authorization: Bearer {personal ? '<personal-token>' : '<operator-token>'}</code>
            </dd>
          </div>
        </dl>
        <p className="settings-hint">{t(personal ? 'account.tokenHint' : 'settings.mcpTokenHint')}</p>
        <p className="settings-hint">{t('settings.mcpCompatibility')}</p>
      </div>
    </section>
  )
}

function PersonalTokens({ onUnauthorized }: { readonly onUnauthorized: () => void }): ReactElement {
  const t = useTranslate()
  const [tokens, setTokens] = useState<readonly UserToken[]>()
  const [name, setName] = useState('')
  const [secret, setSecret] = useState<{ readonly tokenId: string; readonly token: string }>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [revoking, setRevoking] = useState<string>()

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const response = await fetch('/auth/tokens', { credentials: 'same-origin', signal })
        if (response.status == 401) {
          onUnauthorized()
          return
        }
        if (!response.ok) throw new Error('Token list failed.')
        const result = listSchema.parse(await response.json())
        if (signal?.aborted) return
        setTokens(result.tokens)
        setError(undefined)
      } catch {
        if (!signal?.aborted) setError('account.loadFailed')
      }
    },
    [onUnauthorized],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(undefined)
    try {
      const response = await fetch('/auth/tokens', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, name }),
      })
      if (response.status == 401) {
        onUnauthorized()
        return
      }
      if (!response.ok) throw new Error('Token creation failed.')
      const result = createdSchema.parse(await response.json())
      setTokens((current) => [...(current ?? []), result.credential])
      setSecret({ tokenId: result.credential.tokenId, token: result.token })
      setName('')
    } catch {
      setError('account.saveFailed')
    } finally {
      setPending(false)
    }
  }

  async function revoke(tokenId: string): Promise<void> {
    if (pending) return
    setPending(true)
    setError(undefined)
    try {
      const response = await fetch(`/auth/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE', credentials: 'same-origin' })
      if (response.status == 401) {
        onUnauthorized()
        return
      }
      if (!response.ok) throw new Error('Token revocation failed.')
      setTokens((current) => current?.filter((token) => token.tokenId != tokenId))
      setSecret((current) => (current?.tokenId == tokenId ? undefined : current))
      setRevoking(undefined)
    } catch {
      setError('account.saveFailed')
    } finally {
      setPending(false)
    }
  }

  async function copy(): Promise<void> {
    if (secret == null) return
    try {
      await navigator.clipboard.writeText(secret.token)
      toast.success(t('account.copied'))
    } catch {
      toast.error(t('settings.mcpCopyFailed'))
    }
  }

  return (
    <section className="settings-section" aria-labelledby="personal-tokens-title" aria-busy={pending}>
      <div className="settings-heading">
        <div className="settings-heading-copy">
          <h2 id="personal-tokens-title">{t('account.tokens')}</h2>
          <p>{t('account.description')}</p>
        </div>
      </div>
      <div className="settings-form">
        {secret != null && (
          <div className="grid gap-2" aria-live="polite">
            <Label htmlFor="personal-token-secret">{t('account.created')}</Label>
            <Input
              id="personal-token-secret"
              className="font-mono"
              readOnly
              value={secret.token}
              onFocus={(event) => event.target.select()}
              aria-describedby="personal-token-hint"
            />
            <p className="settings-hint" id="personal-token-hint">
              {t('account.once')}
            </p>
            <div className="settings-actions">
              <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
                {t('account.copy')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setSecret(undefined)}>
                {t('account.saved')}
              </Button>
            </div>
          </div>
        )}
        <form className="grid gap-2" onSubmit={(event) => void create(event)}>
          <Label htmlFor="personal-token-name">{t('account.name')}</Label>
          <div className="settings-mcp-address">
            <Input id="personal-token-name" value={name} required maxLength={100} disabled={pending} onChange={(event) => setName(event.target.value)} />
            <Button type="submit" disabled={pending || tokens == null || name.trim().length == 0}>
              {t('account.create')}
            </Button>
          </div>
        </form>
        {error != null && (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        )}
        {tokens == null ? (
          <div className="settings-actions">
            {error == null ? (
              <span role="status">{t('settings.loading')}</span>
            ) : (
              <Button variant="outline" onClick={() => void load()}>
                {t('settings.retry')}
              </Button>
            )}
          </div>
        ) : tokens.length == 0 ? (
          <p className="settings-hint">{t('account.empty')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {tokens.map((token) => (
              <li key={token.tokenId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">{token.name}</span>
                <div className="settings-actions">
                  {revoking == token.tokenId ? (
                    <>
                      <span className="text-sm">{t('account.revokeConfirm')}</span>
                      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setRevoking(undefined)}>
                        {t('settings.cancel')}
                      </Button>
                      <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => void revoke(token.tokenId)}>
                        {t('account.revoke')}
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setRevoking(token.tokenId)}>
                      {t('account.revoke')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export function AccountPage({ user, onUnauthorized }: { readonly user: SessionUser; readonly onUnauthorized: () => void }): ReactElement {
  const t = useTranslate()
  return (
    <main className="settings-page">
      <div className="settings-content">
        <header className="settings-header">
          <h1>{t('account.title')}</h1>
          <p>{user.email ?? 'Operator'}</p>
        </header>
        <McpInformation personal={user.email != null} />
        {user.email != null && <PersonalTokens onUnauthorized={onUnauthorized} />}
      </div>
    </main>
  )
}
