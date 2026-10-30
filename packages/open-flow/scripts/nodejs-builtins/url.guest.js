import { primitive } from '../web.mjs'

const urls = new WeakMap()
const params = new WeakMap()

function stateOf(map, receiver) {
  const state = map.get(receiver)
  if (!state) throw new TypeError('Illegal invocation')
  return state
}

function required(actual, minimum) {
  if (actual < minimum) throw new TypeError(`Expected at least ${minimum} arguments`)
}

function string(value) {
  return `${value}`.toWellFormed()
}

function parse(input, base) {
  return primitive('url', { input: string(input), base: base === undefined ? undefined : string(base) })
}

function updateURL(state, value) {
  state.value = value
  if (state.params) params.get(state.params).list = value.entries
}

function updateParams(state, list) {
  if (state.url) updateURL(state.url, primitive('url', { input: state.url.value.href, entries: list }))
  else state.list = list
}

function iterate(state, kind) {
  return (function* () {
    for (let index = 0; index < state.list.length; index++) {
      const [name, value] = state.list[index]
      yield kind === 'keys' ? name : kind === 'values' ? value : [name, value]
    }
  })()
}

export class URLSearchParams {
  constructor(init = '') {
    let list
    if (init !== null && (typeof init === 'object' || typeof init === 'function')) {
      const iterator = init[Symbol.iterator]
      if (iterator != null) {
        if (typeof iterator !== 'function') throw new TypeError('Expected an iterable')
        list = []
        for (const pair of { [Symbol.iterator]: () => iterator.call(init) }) {
          if (pair === null || (typeof pair !== 'object' && typeof pair !== 'function') || typeof pair[Symbol.iterator] !== 'function') {
            throw new TypeError('Expected a name/value pair')
          }
          const values = Array.from(pair, string)
          if (values.length !== 2) throw new TypeError('Expected a name/value pair')
          list.push(values)
        }
      } else {
        const entries = new Map()
        for (const key of Reflect.ownKeys(init)) {
          if (Object.prototype.propertyIsEnumerable.call(init, key)) entries.set(string(key), string(init[key]))
        }
        list = [...entries]
      }
    } else list = primitive('params.parse', { input: init === null ? '' : string(init) })
    params.set(this, { list, url: undefined })
  }

  get size() {
    return stateOf(params, this).list.length
  }

  append(name, value) {
    const state = stateOf(params, this)
    required(arguments.length, 2)
    const key = string(name),
      text = string(value)
    updateParams(state, [...state.list, [key, text]])
  }

  delete(name, value = undefined) {
    const state = stateOf(params, this)
    required(arguments.length, 1)
    const key = string(name),
      text = value === undefined ? undefined : string(value)
    updateParams(
      state,
      state.list.filter(([k, v]) => k !== key || (text !== undefined && v !== text)),
    )
  }

  get(name) {
    const state = stateOf(params, this)
    required(arguments.length, 1)
    const key = string(name)
    return state.list.find(([k]) => k === key)?.[1] ?? null
  }

  getAll(name) {
    const state = stateOf(params, this)
    required(arguments.length, 1)
    const key = string(name)
    return state.list.filter(([k]) => k === key).map(([, value]) => value)
  }

  has(name, value = undefined) {
    const state = stateOf(params, this)
    required(arguments.length, 1)
    const key = string(name),
      text = value === undefined ? undefined : string(value)
    return state.list.some(([k, v]) => k === key && (text === undefined || v === text))
  }

  set(name, value) {
    const state = stateOf(params, this)
    required(arguments.length, 2)
    const key = string(name),
      text = string(value)
    let found = false
    const list = []
    for (const pair of state.list) {
      if (pair[0] !== key) list.push(pair)
      else if (!found) {
        list.push([key, text])
        found = true
      }
    }
    if (!found) list.push([key, text])
    updateParams(state, list)
  }

  sort() {
    const state = stateOf(params, this)
    updateParams(
      state,
      state.list.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    )
  }

  entries() {
    return iterate(stateOf(params, this), 'entries')
  }
  keys() {
    return iterate(stateOf(params, this), 'keys')
  }
  values() {
    return iterate(stateOf(params, this), 'values')
  }

  forEach(callback, thisArg = undefined) {
    const state = stateOf(params, this)
    if (typeof callback !== 'function') throw new TypeError('Expected a callback')
    for (let index = 0; index < state.list.length; index++) {
      const [name, value] = state.list[index]
      callback.call(thisArg, value, name, this)
    }
  }

  toString() {
    return primitive('params.stringify', { entries: stateOf(params, this).list })
  }
}

export class URL {
  constructor(input, base = undefined) {
    required(arguments.length, 1)
    const value = parse(input, base)
    if (value === null) throw new TypeError('Invalid URL')
    urls.set(this, { value, params: undefined })
  }

  static canParse(input, base = undefined) {
    required(arguments.length, 1)
    return parse(input, base) !== null
  }

  static parse(input, base = undefined) {
    required(arguments.length, 1)
    const value = parse(input, base)
    if (value === null) return null
    const result = Object.create(URL.prototype)
    urls.set(result, { value, params: undefined })
    return result
  }

  get origin() {
    return stateOf(urls, this).value.origin
  }

  get searchParams() {
    const state = stateOf(urls, this)
    if (!state.params) {
      state.params = Object.create(URLSearchParams.prototype)
      params.set(state.params, { list: state.value.entries, url: state })
    }
    return state.params
  }

  toString() {
    return stateOf(urls, this).value.href
  }
  toJSON() {
    return stateOf(urls, this).value.href
  }
}

for (const key of ['href', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash']) {
  Object.defineProperty(URL.prototype, key, {
    enumerable: true,
    configurable: true,
    get() {
      return stateOf(urls, this).value[key]
    },
    set(value) {
      const state = stateOf(urls, this)
      const text = string(value)
      updateURL(state, primitive('url', { input: state.value.href, change: { key, value: text } }))
    },
  })
}

Object.defineProperty(URLSearchParams.prototype, Symbol.iterator, { value: URLSearchParams.prototype.entries, writable: true, configurable: true })
for (const Constructor of [URL, URLSearchParams]) {
  Object.defineProperty(Constructor.prototype, Symbol.toStringTag, { value: Constructor.name, configurable: true })
  for (const key of Object.getOwnPropertyNames(Constructor.prototype)) {
    if (key !== 'constructor') Object.defineProperty(Constructor.prototype, key, { enumerable: true })
  }
}
