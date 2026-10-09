import type { FormEvent, ReactElement } from 'react'

import { Button, Input, Label } from '@oomol-lab/open-flow/ui'
import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'

export type LoginCredentials = { readonly email: string; readonly password: string } | { readonly token: string }

export function Login({
  error,
  pending,
  onSubmit,
}: {
  readonly error?: 'invalid' | 'unavailable'
  readonly pending: boolean
  readonly onSubmit: (credentials: LoginCredentials) => Promise<void>
}): ReactElement {
  const [operator, setOperator] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const t = useTranslate()

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (pending) return
    void onSubmit(operator ? { token: password } : { email, password })
  }

  return (
    <main className="server-login">
      <form className="server-login-form" onSubmit={submit} aria-busy={pending}>
        <header>
          <h1>Open Flow Server</h1>
          <p>{t(operator ? 'session.configured' : 'session.userDescription')}</p>
        </header>
        <fieldset disabled={pending}>
          {operator ? (
            <Input autoComplete="username" name="username" type="hidden" value="open-flow" readOnly />
          ) : (
            <div className="server-login-field">
              <Label htmlFor="login-email">{t('users.email')}</Label>
              <Input
                autoFocus
                autoComplete="username"
                id="login-email"
                name="email"
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          )}
          <div className="server-login-field">
            <Label htmlFor="login-password">{t(operator ? 'session.token' : 'users.password')}</Label>
            <Input
              autoFocus={operator}
              autoComplete="current-password"
              aria-invalid={error == 'invalid'}
              aria-describedby={error == null ? undefined : 'login-error'}
              id="login-password"
              name="password"
              type="password"
              required
              maxLength={operator ? undefined : 1024}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error != null && (
            <p className="server-login-error" id="login-error" role="alert">
              {t(error == 'invalid' ? (operator ? 'session.invalid' : 'session.invalidCredentials') : 'session.unavailable')}
            </p>
          )}
          <Button type="submit" disabled={pending || password.length == 0 || (!operator && email.length == 0)}>
            {t('session.signIn')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOperator(!operator)
              setPassword('')
            }}
          >
            {t(operator ? 'session.userLogin' : 'session.operatorLogin')}
          </Button>
        </fieldset>
      </form>
    </main>
  )
}
