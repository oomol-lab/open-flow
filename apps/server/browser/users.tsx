import type { FormEvent, ReactElement } from 'react'
import type { User } from '../common/users.ts'

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
  NativeSelect,
  NativeSelectOption,
} from '@oomol-lab/open-flow/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { z } from 'zod'
import { HostPage, HostField } from './host-ui.tsx'

const userSchema = z.object({
  userId: z.string().min(1),
  email: z.email(),
  role: z.enum(['admin', 'user']),
  enabled: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: z.number().int(),
})
const listSchema = z.object({ version: z.literal(1), users: z.array(userSchema) })
const savedSchema = z.object({ version: z.literal(1), user: userSchema, password: z.string().min(1).optional() })

export function UsersPage({ currentUserId, onUnauthorized }: { readonly currentUserId: string; readonly onUnauthorized: () => void }): ReactElement {
  const [users, setUsers] = useState<readonly User[]>()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<User['role']>('user')
  const [creating, setCreating] = useState(false)
  const portal = useRef<HTMLElement>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [credentials, setCredentials] = useState<{ readonly email: string; readonly password: string }>()
  const t = useTranslate()
  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const response = await fetch('/auth/users', { credentials: 'same-origin', signal })
        if (response.status == 401) {
          onUnauthorized()
          return
        }
        if (!response.ok) throw new Error('User list failed.')
        setUsers(listSchema.parse(await response.json()).users)
        setError(undefined)
      } catch {
        if (!signal?.aborted) setError('users.loadFailed')
      }
    },
    [onUnauthorized],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function save(path: string, method: 'POST' | 'PUT', body: object): Promise<void> {
    if (pending) return
    setPending(true)
    setError(undefined)
    setCredentials(undefined)
    try {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, version: 1 }),
      })
      if (response.status == 401) {
        onUnauthorized()
        return
      }
      if (response.status == 409) {
        await load()
        setError('users.conflict')
        return
      }
      if (!response.ok) throw new Error('User update failed.')
      const saved = savedSchema.parse(await response.json())
      setUsers((current) =>
        [...(current ?? []).filter((item) => item.userId != saved.user.userId), saved.user].toSorted(
          (a, b) => a.createdAt - b.createdAt || a.userId.localeCompare(b.userId),
        ),
      )
      if (saved.password != null) setCredentials({ email: saved.user.email, password: saved.password })
      if (path == '/auth/users') {
        setEmail('')
        setCreating(false)
      }
    } catch {
      setError('users.saveFailed')
    } finally {
      setPending(false)
    }
  }

  function create(event: FormEvent): void {
    event.preventDefault()
    void save('/auth/users', 'POST', { email, role })
  }

  return (
    <HostPage ref={portal} aria-busy={pending}>
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!pending) {
            setCreating(open)
            setError(undefined)
          }
        }}
      >
        <header className="host-page-header">
          <div className="flex items-center justify-between gap-4">
            <h1>{t('users.title')}</h1>
            <DialogTrigger render={<Button />} disabled={pending || users == null} type="button">
              {t('users.create')}
            </DialogTrigger>
          </div>
          <p>{t('users.description')}</p>
        </header>
        <DialogContent closeLabel={t('settings.cancel')} container={portal.current} initialFocus={() => emailInput.current} showCloseButton={!pending}>
          <form className="flex flex-col gap-4" onSubmit={create}>
            <DialogHeader>
              <DialogTitle>{t('users.create')}</DialogTitle>
            </DialogHeader>
            <HostField id="new-user-email" label={t('users.email')}>
              <Input
                ref={emailInput}
                id="new-user-email"
                name="email"
                type="email"
                autoComplete="off"
                required
                maxLength={254}
                value={email}
                disabled={pending}
                onChange={(event) => setEmail(event.target.value)}
              />
            </HostField>
            <HostField id="new-user-role" label={t('users.role')}>
              <NativeSelect
                className="w-full"
                id="new-user-role"
                value={role}
                disabled={pending}
                onChange={(event) => setRole(event.target.value as User['role'])}
              >
                <NativeSelectOption value="user">{t('users.user')}</NativeSelectOption>
                <NativeSelectOption value="admin">{t('users.admin')}</NativeSelectOption>
              </NativeSelect>
            </HostField>
            {error != null && (
              <p className="text-sm text-destructive" role="alert">
                {t(error)}
              </p>
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />} disabled={pending} type="button">
                {t('settings.cancel')}
              </DialogClose>
              <Button type="submit" disabled={pending || email.trim().length == 0}>
                {t('users.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {credentials != null && (
        <section className="host-card" aria-live="polite">
          <div className="host-card-heading">
            <div className="host-card-heading-copy">
              <h2>{t('users.passwordCreated', { email: credentials.email })}</h2>
            </div>
          </div>
          <div className="host-form">
            <Label htmlFor="generated-password">{t('users.password')}</Label>
            <Input
              className="font-mono"
              id="generated-password"
              value={credentials.password}
              readOnly
              autoComplete="off"
              onFocus={(event) => event.target.select()}
              aria-describedby="generated-password-hint"
            />
            <p className="host-hint" id="generated-password-hint">
              {t('users.passwordHint')}
            </p>
            <div className="host-form-actions">
              <Button type="button" variant="outline" size="sm" onClick={() => setCredentials(undefined)}>
                {t('users.dismiss')}
              </Button>
            </div>
          </div>
        </section>
      )}
      {error != null && !creating && users != null && (
        <p className="text-sm text-destructive" role="alert">
          {t(error)}
        </p>
      )}
      <section className="host-card" aria-label={t('users.title')}>
        <div className="host-card-heading">
          <div className="host-card-heading-copy">
            <h2>{t('users.count', { count: users?.length ?? 0 })}</h2>
          </div>
        </div>
        {users == null ? (
          <div className="host-state" role={error == null ? 'status' : 'alert'}>
            <span>{t(error == null ? 'users.loading' : 'users.loadFailed')}</span>
            {error != null && (
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t('settings.retry')}
              </Button>
            )}
          </div>
        ) : users.length == 0 ? (
          <div className="host-state">
            <span>{t('users.empty')}</span>
          </div>
        ) : (
          <div className="server-user-list">
            <table className="server-user-table">
              <thead>
                <tr>
                  <th scope="col">{t('users.email')}</th>
                  <th scope="col">{t('users.role')}</th>
                  <th scope="col">{t('users.status')}</th>
                  <th scope="col">
                    <span className="sr-only">{t('users.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.userId}>
                    <th scope="row">{user.email}</th>
                    <td>{t(`users.${user.role}`)}</td>
                    <td>
                      <span className={user.enabled ? 'text-foreground' : 'text-muted-foreground'}>{t(user.enabled ? 'users.enabled' : 'users.disabled')}</span>
                    </td>
                    <td>
                      <div className="host-actions justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => void save(`/auth/users/${user.userId}/password`, 'POST', { expectedRevision: user.revision })}
                        >
                          {t('users.resetPassword')}
                        </Button>
                        <Button
                          type="button"
                          variant={user.enabled ? 'destructive' : 'outline'}
                          size="sm"
                          disabled={pending || user.userId == currentUserId}
                          onClick={() => void save(`/auth/users/${user.userId}`, 'PUT', { enabled: !user.enabled, expectedRevision: user.revision })}
                        >
                          {t(user.enabled ? 'users.disable' : 'users.enable')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </HostPage>
  )
}
