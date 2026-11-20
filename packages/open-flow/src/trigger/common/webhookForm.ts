import type { JsonValue } from '../../flow/common/model.ts'
import type { WebhookBodyField, WebhookForm, WebhookOptions } from './model.ts'

/** Character limits of the plain-text form settings. */
export const webhookFormLimits = { label: 200, description: 2000 } as const

/** One browser control derived from a declared body field. */
export interface WebhookFormControl {
  readonly name: string
  readonly label: string
  readonly help?: string
  readonly kind: 'text' | 'number' | 'integer' | 'checkbox' | 'select'
  readonly options?: readonly string[]
  readonly required: boolean
  readonly defaultValue?: JsonValue
}

/** A Webhook configuration that contradicts form mode, or a field the page cannot render. */
export type WebhookFormIssue =
  | { readonly code: 'conflict'; readonly setting: 'method' | 'authentication' | 'bodyMode' | 'responseBody' }
  | { readonly code: 'field-unsupported'; readonly field: string }

/** Thrown when a browser submission cannot be converted to the declared body. */
export class WebhookFormInvalid extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookFormInvalid'
  }
}

function schemaRecord(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> {
  return value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Readonly<Record<string, JsonValue>>) : {}
}

function plainString(value: JsonValue | undefined): string | undefined {
  return typeof value == 'string' && value.trim().length > 0 ? value : undefined
}

/** The control for a field, or undefined when its schema is not a single scalar type or a string enum. */
export function webhookFormControl(field: WebhookBodyField): WebhookFormControl | undefined {
  const schema = schemaRecord(field.jsonSchema)
  const type = schema.type
  const common = {
    name: field.handle,
    label: plainString(schema.title) ?? field.handle,
    ...(plainString(schema.description) == null ? {} : { help: plainString(schema.description)! }),
    required: !field.nullable && !Object.hasOwn(field, 'value'),
    ...(Object.hasOwn(field, 'value') ? { defaultValue: field.value } : {}),
  }
  if (Array.isArray(schema.enum)) {
    if ((type != null && type != 'string') || schema.enum.length == 0 || !schema.enum.every((item) => typeof item == 'string')) return
    return { ...common, kind: 'select', options: schema.enum as readonly string[] }
  }
  switch (type) {
    case 'string':
      return { ...common, kind: 'text' }
    case 'number':
      return { ...common, kind: 'number' }
    case 'integer':
      return { ...common, kind: 'integer' }
    case 'boolean':
      // An unchecked box submits nothing, which the body records as false.
      return { ...common, kind: 'checkbox', required: false }
    default:
      return
  }
}

/** Settings that form mode excludes and fields it cannot render, in declaration order. */
export function webhookFormIssues(trigger: {
  readonly bodyFields: readonly WebhookBodyField[]
  readonly method: string
  readonly options?: WebhookOptions
}): readonly WebhookFormIssue[] {
  const options = trigger.options
  if (options?.form == null) return []
  const issues: WebhookFormIssue[] = []
  if (trigger.method != 'POST') issues.push({ code: 'conflict', setting: 'method' })
  if (options.authentication != null) issues.push({ code: 'conflict', setting: 'authentication' })
  if (options.bodyMode == 'any') issues.push({ code: 'conflict', setting: 'bodyMode' })
  if (options.responseBody != null) issues.push({ code: 'conflict', setting: 'responseBody' })
  for (const field of trigger.bodyFields) if (webhookFormControl(field) == null) issues.push({ code: 'field-unsupported', field: field.handle })
  return issues
}

/** Browser form encodings; JSON requests keep the ordinary Webhook contract. */
export function isWebhookFormContentType(contentType: string | null | undefined): boolean {
  const media = contentType?.split(';')[0]?.trim().toLowerCase()
  return media == 'application/x-www-form-urlencoded' || media == 'multipart/form-data'
}

/**
 * Converts submitted entries to the declared body. Empty values are omitted so that defaults, null and required-field
 * validation apply as for JSON requests. Undeclared names are ignored. Files, repeated names and non-numeric numbers
 * are rejected.
 */
export function webhookFormBody(
  fields: readonly WebhookBodyField[],
  entries: Iterable<readonly [string, FormDataEntryValue]>,
): Readonly<Record<string, JsonValue>> {
  const controls = new Map(fields.map((field) => [field.handle, webhookFormControl(field)]))
  const values = new Map<string, string>()
  for (const [name, value] of entries) {
    if (!controls.has(name)) continue
    if (typeof value != 'string') throw new WebhookFormInvalid(`Field ${name} does not accept files.`)
    if (values.has(name)) throw new WebhookFormInvalid(`Field ${name} was submitted more than once.`)
    values.set(name, value)
  }
  const body: Record<string, JsonValue> = {}
  for (const [name, item] of controls) {
    if (item == null) throw new WebhookFormInvalid(`Field ${name} cannot be submitted from a form.`)
    const value = values.get(name)
    if (item.kind == 'checkbox') {
      body[name] = value != null && value != 'false' && value != '0'
      continue
    }
    if (value == null || value.length == 0) continue
    if (item.kind == 'number' || item.kind == 'integer') {
      const number = value.trim().length == 0 ? Number.NaN : Number(value)
      if (!Number.isFinite(number) || (item.kind == 'integer' && !Number.isInteger(number)))
        throw new WebhookFormInvalid(`Field ${name} is not a valid number.`)
      body[name] = number
      continue
    }
    body[name] = value
  }
  return body
}

const copy = {
  'en': [
    'Submit',
    'Thank you. Your response has been submitted.',
    'Some answers are missing or invalid. Go back, check the form and submit it again.',
    'The submission is too large.',
    'Too many submissions. Try again later.',
    'The form is unavailable. Try again later.',
    'Back to the form',
    'Required',
  ],
  'zh-CN': [
    '提交',
    '感谢填写，已成功提交。',
    '有内容缺失或格式不正确。请返回检查表单后重新提交。',
    '提交的内容过大。',
    '提交过于频繁，请稍后再试。',
    '表单暂时不可用，请稍后再试。',
    '返回表单',
    '必填',
  ],
  'zh-TW': [
    '提交',
    '感謝填寫，已成功提交。',
    '有內容缺漏或格式不正確。請返回檢查表單後重新提交。',
    '提交的內容過大。',
    '提交過於頻繁，請稍後再試。',
    '表單暫時無法使用，請稍後再試。',
    '返回表單',
    '必填',
  ],
  'ja': [
    '送信',
    'ご回答ありがとうございます。送信が完了しました。',
    '未入力または正しくない項目があります。フォームに戻って確認し、もう一度送信してください。',
    '送信内容が大きすぎます。',
    '送信回数が多すぎます。しばらくしてからもう一度お試しください。',
    'フォームは現在利用できません。しばらくしてからもう一度お試しください。',
    'フォームに戻る',
    '必須',
  ],
  'ko': [
    '제출',
    '감사합니다. 응답이 제출되었습니다.',
    '누락되었거나 올바르지 않은 항목이 있습니다. 양식으로 돌아가 확인한 뒤 다시 제출하세요.',
    '제출 내용이 너무 큽니다.',
    '제출이 너무 많습니다. 잠시 후 다시 시도하세요.',
    '양식을 지금 사용할 수 없습니다. 잠시 후 다시 시도하세요.',
    '양식으로 돌아가기',
    '필수',
  ],
  'fr': [
    'Envoyer',
    'Merci. Votre réponse a été envoyée.',
    'Certaines réponses sont manquantes ou invalides. Revenez au formulaire, vérifiez-le puis renvoyez-le.',
    'L’envoi est trop volumineux.',
    'Trop d’envois. Réessayez plus tard.',
    'Le formulaire est indisponible. Réessayez plus tard.',
    'Revenir au formulaire',
    'Obligatoire',
  ],
  'ru': [
    'Отправить',
    'Спасибо. Ваш ответ отправлен.',
    'Некоторые ответы отсутствуют или неверны. Вернитесь к форме, проверьте её и отправьте снова.',
    'Отправка слишком велика.',
    'Слишком много отправок. Повторите попытку позже.',
    'Форма недоступна. Повторите попытку позже.',
    'Вернуться к форме',
    'Обязательно',
  ],
} as const

function locale(acceptLanguage: string | null | undefined): keyof typeof copy {
  const preferred = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim().toLowerCase() ?? 'en'
  const requested = preferred.startsWith('zh') ? (/tw|hk|hant/.test(preferred) ? 'zh-TW' : 'zh-CN') : preferred.split('-')[0]!
  return Object.hasOwn(copy, requested) ? (requested as keyof typeof copy) : 'en'
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
}

function control(item: WebhookFormControl, required: string): string {
  const id = `field-${escape(encodeURIComponent(item.name))}`
  const name = escape(item.name)
  const attributes = `id="${id}" name="${name}"${item.required ? ' required' : ''}${item.help == null ? '' : ` aria-describedby="${id}-help"`}`
  const fallback = item.defaultValue
  const label = `<label for="${id}">${escape(item.label)}${item.required ? ` <span class="required">${escape(required)}</span>` : ''}</label>`
  const help = item.help == null ? '' : `<small id="${id}-help">${escape(item.help)}</small>`
  switch (item.kind) {
    case 'checkbox':
      return `<div class="field check"><input type="checkbox" value="true" ${attributes}${fallback === true ? ' checked' : ''} />${label}${help}</div>`
    case 'select':
      return `<div class="field">${label}<select ${attributes}><option value=""></option>${(item.options ?? [])
        .map((option) => `<option value="${escape(option)}"${fallback === option ? ' selected' : ''}>${escape(option)}</option>`)
        .join('')}</select>${help}</div>`
    case 'number':
    case 'integer':
      return `<div class="field">${label}<input type="number" step="${item.kind == 'integer' ? '1' : 'any'}" ${attributes}${
        typeof fallback == 'number' ? ` value="${fallback}"` : ''
      } />${help}</div>`
    case 'text':
      return `<div class="field">${label}<textarea rows="2" ${attributes}>${typeof fallback == 'string' ? escape(fallback) : ''}</textarea>${help}</div>`
  }
}

/** Response headers every form page carries; the page has no scripts and posts only to itself. */
export const webhookFormPageHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'content-type': 'text/html; charset=utf-8',
  // A no-referrer page would send `Origin: null` with its own POST, which the same-origin check must reject.
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
} as const

/**
 * The hosted form page, or a result page after a submission. `status` 200 with `submitted` shows the success message;
 * other statuses show a fixed localized reason with a link back to the form.
 */
export function renderWebhookFormPage(input: {
  readonly form: WebhookForm
  readonly name: string
  readonly bodyFields: readonly WebhookBodyField[]
  readonly acceptLanguage?: string | null
  readonly result?: { readonly status: number }
}): string {
  const language = locale(input.acceptLanguage)
  const [submit, submitted, invalid, tooLarge, tooMany, unavailable, back, required] = copy[language]
  const title = escape(input.form.title?.trim() || input.name)
  const result = input.result
  let body: string
  if (result == null) {
    const controls = input.bodyFields.map((field) => webhookFormControl(field)).filter((item) => item != null)
    body = `${input.form.description?.trim() ? `<p class="description">${escape(input.form.description)}</p>` : ''}<form method="post" enctype="application/x-www-form-urlencoded" accept-charset="utf-8">${controls
      .map((item) => control(item, required))
      .join('')}<div class="actions"><button type="submit">${escape(input.form.submitLabel?.trim() || submit)}</button></div></form>`
  } else if (result.status >= 200 && result.status < 300) {
    body = `<p role="status" class="description">${escape(input.form.successMessage?.trim() || submitted)}</p>`
  } else {
    const reason = result.status == 413 ? tooLarge : result.status == 429 ? tooMany : result.status == 400 ? invalid : unavailable
    body = `<p role="alert">${escape(reason)}</p><p><a href="">${escape(back)}</a></p>`
  }
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>${title}</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:light-dark(#f7f7f8,#151517);color:light-dark(#242426,#eeeeef)}
*{box-sizing:border-box}body{margin:0;padding:48px 20px}main{max-width:600px;margin:auto;padding:32px;border:1px solid light-dark(#e3e3e6,#38383c);border-radius:16px;background:light-dark(#fff,#202023)}
h1{font-size:24px;margin:0 0 16px;line-height:1.3;overflow-wrap:anywhere}p{line-height:1.6;overflow-wrap:anywhere}.description{white-space:pre-wrap}
.field{margin:20px 0}label{display:block;margin-bottom:8px;font-size:14px}.required{color:light-dark(#626269,#aaaab3);font-size:12px}small{display:block;margin-top:6px;color:light-dark(#626269,#aaaab3);line-height:1.5}
input,select,textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid light-dark(#ceced3,#505058);border-radius:8px;background:light-dark(#fff,#202023);color:inherit}textarea{resize:vertical}
.check{display:grid;grid-template-columns:auto 1fr;column-gap:10px;align-items:start}.check input{width:auto;margin:3px 0 0}.check label{margin:0}.check small{grid-column:2}
.actions{margin-top:24px}button{font:inherit;padding:10px 20px;border:1px solid transparent;border-radius:8px;background:light-dark(#242426,#eeeef0);color:light-dark(#fff,#242426);cursor:pointer}
:focus-visible{outline:2px solid #5586e8;outline-offset:3px}a{color:inherit}@media (max-width:480px){body{padding:20px 12px}main{padding:24px}}
</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`
}
