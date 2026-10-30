import process from 'process'

process.nextTick = (callback, ...args) => queueMicrotask(() => callback(...args))
process.cwd = () => '/tmp'
export default process
