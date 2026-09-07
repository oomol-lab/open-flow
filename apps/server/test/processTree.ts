import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function childProcessId(parentId: number, marker: string): Promise<number> {
  if (process.platform == 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$ErrorActionPreference = "Stop"; Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine | ConvertTo-Json -Compress',
    ])
    const rows = JSON.parse(stdout) as
      | { readonly ProcessId?: number; readonly ParentProcessId?: number; readonly CommandLine?: string }
      | readonly { readonly ProcessId?: number; readonly ParentProcessId?: number; readonly CommandLine?: string }[]
    const processes = Array.isArray(rows) ? rows : [rows]
    const match = processes.find((entry) => entry.ParentProcessId == parentId && typeof entry.CommandLine == 'string' && entry.CommandLine.includes(marker))
    if (match?.ProcessId == null) throw new Error('Child process was not found.')
    return match.ProcessId
  }

  const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=,ppid=,command='])
  const match = stdout
    .split('\n')
    .map((line) => /^(\s*\d+)\s+(\d+)\s+(.+)$/.exec(line))
    .find((entry) => entry?.[2] == String(parentId) && entry[3].includes(marker))
  if (match == null) throw new Error('Child process was not found.')
  return Number(match[1])
}
