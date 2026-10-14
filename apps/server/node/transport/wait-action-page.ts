import type { WaitAction } from '@oomol-lab/open-flow/flow-change'

import { html } from 'hono/html'

const copy = {
  'en': [
    'Review request',
    'Approve',
    'Reject',
    'Continue',
    'Comment (optional)',
    'Submit your decision to continue the workflow.',
    'Expires at',
    'This request has been processed.',
    'This link is unavailable or has expired.',
    'Please try again shortly.',
    'Enter a comment of no more than 2,000 characters.',
    'Return to request',
  ],
  'zh-CN': [
    '处理请求',
    '同意',
    '拒绝',
    '继续',
    '意见（选填）',
    '确认提交后，工作流将按你的决定继续。',
    '有效期至',
    '此请求已处理。',
    '此链接不可用或已过期。',
    '请求过于频繁，请稍后重试。',
    '请输入不超过 2,000 个字符的意见。',
    '返回请求',
  ],
  'zh-TW': [
    '處理請求',
    '同意',
    '拒絕',
    '繼續',
    '意見（選填）',
    '確認提交後，工作流程將依你的決定繼續。',
    '有效期至',
    '此請求已處理。',
    '此連結無法使用或已過期。',
    '請稍後重試。',
    '請輸入不超過 2,000 個字元的意見。',
    '返回請求',
  ],
  'ja': [
    'リクエストの確認',
    '承認',
    '却下',
    '続行',
    'コメント（任意）',
    '決定を送信するとワークフローが続行されます。',
    '有効期限',
    'このリクエストは処理済みです。',
    'リンクが無効か期限切れです。',
    'しばらくしてから再試行してください。',
    'コメントは2,000文字以内で入力してください。',
    'リクエストに戻る',
  ],
  'ko': [
    '요청 검토',
    '승인',
    '거절',
    '계속',
    '의견 (선택)',
    '결정을 제출하면 워크플로가 계속됩니다.',
    '만료 시간',
    '이미 처리된 요청입니다.',
    '사용할 수 없거나 만료된 링크입니다.',
    '잠시 후 다시 시도하세요.',
    '의견을 2,000자 이내로 입력하세요.',
    '요청으로 돌아가기',
  ],
  'fr': [
    'Examiner la demande',
    'Approuver',
    'Refuser',
    'Continuer',
    'Commentaire (facultatif)',
    'Envoyez votre décision pour poursuivre le workflow.',
    'Expiration',
    'Cette demande a été traitée.',
    'Ce lien est indisponible ou a expiré.',
    'Veuillez réessayer dans un instant.',
    'Saisissez un commentaire de 2 000 caractères maximum.',
    'Revenir à la demande',
  ],
  'ru': [
    'Рассмотреть запрос',
    'Одобрить',
    'Отклонить',
    'Продолжить',
    'Комментарий (необязательно)',
    'Отправьте решение, чтобы продолжить рабочий процесс.',
    'Срок действия',
    'Этот запрос уже обработан.',
    'Ссылка недоступна или срок её действия истёк.',
    'Повторите попытку позже.',
    'Введите комментарий длиной не более 2 000 символов.',
    'Вернуться к запросу',
  ],
} as const

export async function waitActionPage(
  path: string,
  language: string | undefined,
  status: number,
  result?: {
    readonly state: 'waiting' | 'resolved' | 'unavailable'
    readonly action: WaitAction | null
    readonly prompt?: string
    readonly expiresAt?: string
  },
): Promise<Response> {
  const preferred = language?.split(',')[0]?.split(';')[0]?.trim().toLowerCase() ?? 'en'
  const requested = preferred.startsWith('zh') ? (/tw|hk|hant/.test(preferred) ? 'zh-TW' : 'zh-CN') : preferred.split('-')[0]!
  const locale = Object.hasOwn(copy, requested) ? (requested as keyof typeof copy) : 'en'
  const [title, approve, reject, proceed, comment, help, expiry, resolved, unavailable, limited, invalid, back] = copy[locale]
  const labels = { approve, reject, continue: proceed }
  const actions: readonly WaitAction[] = result?.action == 'continue' ? ['continue'] : ['approve', 'reject']
  const body = await html`<!doctype html>
    <html lang="${locale}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} · Open Flow</title>
        <style>
          :root {
            color-scheme: light dark;
            font-family: system-ui, sans-serif;
            background: light-dark(#f7f7f8, #151517);
            color: light-dark(#242426, #eeeeef);
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            padding: 48px 20px;
          }
          main {
            max-width: 600px;
            margin: auto;
            padding: 32px;
            border: 1px solid light-dark(#e3e3e6, #38383c);
            border-radius: 16px;
            background: light-dark(#fff, #202023);
          }
          header {
            font-size: 14px;
            color: light-dark(#626269, #aaaab3);
          }
          h1 {
            font-size: 24px;
            margin: 24px 0 16px;
            line-height: 1.3;
          }
          p {
            line-height: 1.6;
            overflow-wrap: anywhere;
          }
          .prompt {
            white-space: pre-wrap;
          }
          small {
            display: block;
            color: light-dark(#626269, #aaaab3);
            line-height: 1.6;
          }
          label {
            display: block;
            margin: 24px 0 8px;
            font-size: 14px;
          }
          textarea {
            width: 100%;
            min-height: 112px;
            resize: vertical;
            font: inherit;
            padding: 12px;
            border: 1px solid light-dark(#ceced3, #505058);
            border-radius: 8px;
            background: light-dark(#fff, #202023);
            color: inherit;
          }
          .actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            margin-top: 20px;
          }
          button,
          a {
            font: inherit;
          }
          button {
            padding: 10px 20px;
            border: 1px solid light-dark(#ceced3, #505058);
            border-radius: 8px;
            background: light-dark(#f6f6f8, #303034);
            color: inherit;
            cursor: pointer;
          }
          button:first-child {
            background: light-dark(#242426, #eeeef0);
            color: light-dark(#fff, #242426);
            border-color: transparent;
          }
          :focus-visible {
            outline: 2px solid #5586e8;
            outline-offset: 3px;
          }
          a {
            color: inherit;
          }
          footer {
            margin-top: 24px;
          }
          @media (max-width: 480px) {
            body {
              padding: 20px 12px;
            }
            main {
              padding: 24px;
            }
          }
        </style>
      </head>
      <body>
        <main>
          <header>Open Flow</header>
          <h1>${title}</h1>
          ${status != 200
            ? html`<p role="alert">${status == 429 ? limited : status == 400 ? invalid : unavailable}</p>
                ${status == 400 || status == 429 ? html`<a href="${path}">${back}</a>` : ''}`
            : result?.state == 'waiting'
              ? html`<p class="prompt">${result.prompt}</p>
                  <small>${expiry}: ${result.expiresAt}</small>
                  <form method="post" action="${path}">
                    <label for="comment">${comment}</label><textarea id="comment" name="comment"></textarea>
                    <div class="actions">
                      ${actions.map((action) => html`<button type="submit" formaction="${path.replace(/\/[^/]+$/, `/${action}`)}">${labels[action]}</button>`)}
                    </div>
                    <footer><small>${help}</small></footer>
                  </form>`
              : html`<p role="status">${result?.state == 'resolved' && result.action != null ? `${resolved} ${labels[result.action]}` : unavailable}</p>`}
        </main>
      </body>
    </html>`
  return new Response(body.toString(), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'vary': 'Accept, Accept-Language',
    },
  })
}
