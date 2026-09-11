import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

function identifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

export function insert(database: DatabaseSync, table: string, values: Readonly<Record<string, SQLInputValue>>) {
  const entries = Object.entries(values)
  return database
    .prepare(`INSERT INTO ${identifier(table)} (${entries.map(([column]) => identifier(column)).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`)
    .run(...entries.map(([, value]) => value))
}
