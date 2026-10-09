import type { FormEvent, ReactElement } from 'react'
import type { SessionUser, UserToken } from '../common/users.ts'

import { mcpProtocolVersion } from '@oomol-lab/open-flow/mcp'
import { Button, Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label } from '@oomol-lab/open-flow/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [secret, setSecret] = useState<string>()
  const [creating, setCreating] = useState(false)
  const portal = useRef<HTMLElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
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
      setSecret(result.token)
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
      await navigator.clipboard.writeText(secret)
      toast.success(t('account.copied'))
    } catch {
      toast.error(t('settings.mcpCopyFailed'))
    }
  }

  return (
    <section ref={portal} className="settings-section" aria-labelledby="personal-tokens-title" aria-busy={pending}>
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (pending || secret != null) return
          setCreating(open)
          setName('')
          setError(undefined)
          setRevoking(undefined)
        }}
      >
        <div className="settings-heading">
          <div className="settings-heading-copy">
            <h2 id="personal-tokens-title">{t('account.tokens')}</h2>
            <p>{t('account.description')}</p>
          </div>
          <DialogTrigger render={<Button size="sm" />} disabled={pending || tokens == null} type="button">
            {t('account.create')}
          </DialogTrigger>
        </div>
        <DialogContent
          container={portal.current}
          initialFocus={() => nameInput.current}
          showCloseButton={!pending && secret == null}
          closeLabel={t('settings.cancel')}
        >
          {secret == null ? (
            <form className="flex flex-col gap-4" onSubmit={(event) => void create(event)}>
              <DialogHeader>
                <DialogTitle>{t('account.create')}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="personal-token-name">{t('account.name')}</Label>
                <Input
                  ref={nameInput}
                  id="personal-token-name"
                  value={name}
                  required
                  maxLength={100}
                  disabled={pending}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              {error != null && (
                <p role="alert" className="text-sm text-destructive">
                  {t(error)}
                </p>
              )}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />} disabled={pending} type="button">
                  {t('settings.cancel')}
                </DialogClose>
                <Button type="submit" disabled={pending || name.trim().length == 0}>
                  {t('account.create')}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>{t('account.created')}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="personal-token-secret">{name.trim()}</Label>
                <Input
                  id="personal-token-secret"
                  className="font-mono"
                  readOnly
                  value={secret}
                  onFocus={(event) => event.target.select()}
                  aria-describedby="personal-token-hint"
                />
                <p className="m-0 text-sm text-muted-foreground" id="personal-token-hint">
                  {t('account.once')}
                </p>
              </div>
              <DialogFooter>
                <Button autoFocus type="button" variant="outline" onClick={() => void copy()}>
                  {t('account.copy')}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setSecret(undefined)
                    setCreating(false)
                    setName('')
                  }}
                >
                  {t('account.saved')}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <div className="settings-form">
        {error != null && !creating && (
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
