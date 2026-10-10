import type { FormEvent, ReactElement } from 'react'
import type { UserToken } from '../common/users.ts'

import { mcpProtocolVersion } from '@oomol-lab/open-flow/mcp'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@oomol-lab/open-flow/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Trans, useTranslate } from 'val-i18n-react'
import { z } from 'zod'
import { HostPage, HostField, HostPageLayout, HostPageTabs } from './host-ui.tsx'

const tokenSchema = z.object({ tokenId: z.string().min(1), name: z.string().min(1), createdAt: z.number().int() })
const listSchema = z.object({ version: z.literal(1), tokens: z.array(tokenSchema) })
const createdSchema = z.object({ version: z.literal(1), credential: tokenSchema, token: z.string().min(1) })

function McpInformation(): ReactElement {
  const t = useTranslate()
  const endpoint = new URL('/v1/mcp', window.location.origin).href

  async function copyAddress(): Promise<void> {
    try {
      await navigator.clipboard.writeText(endpoint)
      toast.success(t('agentAccess.mcpCopied'))
    } catch {
      toast.error(t('agentAccess.mcpCopyFailed'))
    }
  }

  return (
    <section aria-labelledby="settings-mcp-title">
      <header className="host-page-header">
        <h1 id="settings-mcp-title">{t('agentAccess.mcpTitle')}</h1>
        <p>{t('agentAccess.mcpDescription')}</p>
      </header>
      <div className="host-card host-form">
        <Label htmlFor="settings-mcp-endpoint">{t('agentAccess.mcpAddress')}</Label>
        <div className="settings-mcp-address">
          <Input id="settings-mcp-endpoint" readOnly value={endpoint} />
          <Button variant="outline" size="sm" type="button" onClick={() => void copyAddress()}>
            {t('agentAccess.mcpCopy')}
          </Button>
        </div>
        <dl className="settings-mcp-details">
          <div>
            <dt>{t('agentAccess.mcpTransport')}</dt>
            <dd>Streamable HTTP</dd>
          </div>
          <div>
            <dt>{t('agentAccess.mcpProtocol')}</dt>
            <dd>{mcpProtocolVersion}</dd>
          </div>
          <div>
            <dt>{t('agentAccess.mcpAuthentication')}</dt>
            <dd>
              <code>Authorization: Bearer {'<personal-token>'}</code>
            </dd>
          </div>
        </dl>
        <p className="host-hint">{t('account.tokenHint')}</p>
      </div>
    </section>
  )
}

const commandPlatforms = [
  { value: 'macos', label: 'macOS' },
  { value: 'linux', label: 'Linux' },
  { value: 'windows', label: 'Windows PowerShell' },
] as const

function PlatformCommands({
  label,
  platform,
  onPlatformChange,
  posix,
  windows,
}: {
  readonly label: string
  readonly platform: string
  readonly onPlatformChange: (value: string) => void
  readonly posix: string
  readonly windows: string
}): ReactElement {
  return (
    <Tabs value={platform} onValueChange={onPlatformChange} className="my-2">
      <TabsList aria-label={label} variant="navigation" size="sm">
        {commandPlatforms.map(({ value, label: platformLabel }) => (
          <TabsTrigger key={value} value={value}>
            {platformLabel}
          </TabsTrigger>
        ))}
      </TabsList>
      {commandPlatforms.map(({ value }) => (
        <TabsContent key={value} value={value}>
          <pre>
            <code>{value == 'windows' ? windows : posix}</code>
          </pre>
        </TabsContent>
      ))}
    </Tabs>
  )
}

function CliInformation(): ReactElement {
  const t = useTranslate()
  const origin = window.location.origin
  const [platform, setPlatform] = useState(() => {
    if (navigator.userAgent.includes('Windows')) return 'windows'
    if (navigator.userAgent.includes('Linux')) return 'linux'
    return 'macos'
  })
  const token = '<personal-token>'
  return (
    <section aria-labelledby="agent-cli-title">
      <header className="host-page-header">
        <h1 id="agent-cli-title">{t('agentAccess.cliTitle')}</h1>
        <p>{t('agentAccess.cliDescription')}</p>
      </header>
      <div className="host-card host-form agent-cli">
        <h2>{t('agentAccess.install')}</h2>
        <div className="grid gap-2 pl-4">
          <p className="host-hint m-0 leading-[18px]">
            <Trans message={t('agentAccess.openSource')}>
              <a href="https://github.com/oomol-lab/oo-cli" target="_blank" rel="noreferrer">
                oo-cli
              </a>
            </Trans>
          </p>
          <PlatformCommands
            label={t('agentAccess.install')}
            platform={platform}
            onPlatformChange={setPlatform}
            posix="curl -fsSL https://cli.oomol.com/install.sh | bash"
            windows="irm https://cli.oomol.com/install.ps1 | iex"
          />
        </div>
        <h2 className="pt-4">{t('agentAccess.connect')}</h2>
        <div className="grid gap-2 pl-4">
          <p className="host-hint m-0 leading-[18px]">{t('agentAccess.environmentHint')}</p>
          <PlatformCommands
            label={t('agentAccess.connect')}
            platform={platform}
            onPlatformChange={setPlatform}
            posix={`export OO_OPEN_FLOW_URL='${origin}'\nexport OO_OPEN_FLOW_TOKEN='${token}'`}
            windows={`$env:OO_OPEN_FLOW_URL = '${origin}'\n$env:OO_OPEN_FLOW_TOKEN = '${token}'`}
          />
          <p className="host-hint m-0 leading-[18px]">{t('account.tokenHint')}</p>
        </div>
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
      toast.error(t('agentAccess.mcpCopyFailed'))
    }
  }

  return (
    <section ref={portal} className="host-card" aria-labelledby="personal-tokens-title" aria-busy={pending}>
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
        <div className="host-card-heading">
          <div className="host-card-heading-copy">
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
              <HostField id="personal-token-name" label={t('account.name')}>
                <Input
                  ref={nameInput}
                  id="personal-token-name"
                  value={name}
                  required
                  maxLength={100}
                  disabled={pending}
                  onChange={(event) => setName(event.target.value)}
                />
              </HostField>
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
              <HostField id="personal-token-secret" label={name.trim()}>
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
              </HostField>
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
      <div className="host-form">
        {error != null && !creating && (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        )}
        {tokens == null ? (
          <div className="host-actions">
            {error == null ? (
              <span role="status">{t('settings.loading')}</span>
            ) : (
              <Button variant="outline" onClick={() => void load()}>
                {t('settings.retry')}
              </Button>
            )}
          </div>
        ) : tokens.length == 0 ? (
          <p className="host-hint">{t('account.empty')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {tokens.map((token) => (
              <li key={token.tokenId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">{token.name}</span>
                <div className="host-actions">
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

export function AgentAccessPage({ onUnauthorized }: { readonly onUnauthorized: () => void }): ReactElement {
  const t = useTranslate()
  return (
    <Tabs defaultValue="cli" className="h-full min-h-0">
      <HostPageLayout
        navigation={
          <HostPageTabs
            kind="panels"
            label={t('agentAccess.title')}
            items={[
              { value: 'cli', label: 'CLI' },
              { value: 'mcp', label: 'MCP' },
            ]}
          />
        }
      >
        <HostPage aria-label={t('agentAccess.title')}>
          <TabsContent value="cli">
            <CliInformation />
          </TabsContent>
          <TabsContent value="mcp">
            <McpInformation />
          </TabsContent>
          <PersonalTokens onUnauthorized={onUnauthorized} />
        </HostPage>
      </HostPageLayout>
    </Tabs>
  )
}
