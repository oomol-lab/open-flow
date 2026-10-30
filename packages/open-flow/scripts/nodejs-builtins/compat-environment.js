import { Buffer } from 'buffer'
import * as webStreams from 'web-streams-polyfill'
import { AbortController, AbortSignal } from './compat-abort.js'
import process from './compat-process.js'

Object.assign(globalThis, { Buffer, process, AbortController, AbortSignal, ...webStreams })
