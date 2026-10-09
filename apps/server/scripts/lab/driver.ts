import type { CommandRecord } from '@oomol-lab/open-flow-command/lab'
import type { LabSession } from './session.ts'

import { runLabCli } from '@oomol-lab/open-flow-command/lab'
import { mcpProtocolVersion } from '@oomol-lab/open-flow/mcp'
import { randomUUID, createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
export type ToolCall = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
export function driver(lab: LabSession, transport: 'cli' | 'mcp'): ToolCall {
  lab.attempt.transport = transport
  return async (name, args) => {
    const id = randomUUID(),
      started = performance.now()
    lab.active.add(id)
    let stdout = '',
      stderr = '',
      record: CommandRecord
    try {
      if (transport == 'cli') {
        const query = { ...args }
        delete query.flowId
        let argv: string[]
        switch (name) {
          case 'flow_read':
          case 'flow_search':
          case 'flow_edit':
            argv = [name.slice(5), String(args.flowId), '--input', JSON.stringify(query), '--json']
            break
          case 'flow_schema':
            argv = [
              'schema',
              ...(args.type == null ? [] : [String(args.type)]),
              ...(args.flowId == null ? [] : ['--flow', String(args.flowId)]),
              ...(args.action == null ? [] : ['--input', JSON.stringify({ action: args.action })]),
              '--json',
            ]
            break
          case 'connector_search':
            argv = ['connector', 'search', String(args.query), '--flow', String(args.flowId), '--json']
            break
          case 'connector_connections':
            argv = ['connector', 'connections', String(args.serviceId), '--flow', String(args.flowId), '--json']
            break
          case 'flow_check':
            argv = ['check', String(args.flowId), '--revision', String(args.revisionId), '--json']
            break
          case 'run_list':
            argv = ['runs', 'list', '--flow', String(args.flowId), '--json']
            break
          case 'run_events':
            argv = ['runs', 'events', String(args.runId), '--json']
            break
          default:
            throw new Error(`Unsupported Lab driver tool ${name}`)
        }
        record = await runLabCli(argv, {
          id,
          origin: lab.manifest.origin,
          token: lab.token,
          output: (stream, value) => {
            if (stream == 'stdout') stdout += value
            else stderr += value
          },
        })
      } else {
        const body = JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: {
            name,
            arguments: args,
            _meta: { 'io.modelcontextprotocol/protocolVersion': mcpProtocolVersion, 'io.modelcontextprotocol/clientCapabilities': {} },
          },
        })
        const response = await fetch(`${lab.manifest.origin}/v1/mcp`, {
          method: 'POST',
          headers: {
            'authorization': `Bearer ${lab.token}`,
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream',
            'mcp-protocol-version': mcpProtocolVersion,
            'mcp-method': 'tools/call',
            'mcp-name': name,
            'x-lab-command': id,
          },
          body,
        })
        const excludedMs = Number(response.headers.get('x-lab-excluded-ms') ?? 0)
        const raw = await response.text(),
          parsed = JSON.parse(
            response.headers.get('content-type')?.includes('text/event-stream')
              ? raw
                  .split('\n')
                  .findLast((l) => l.startsWith('data:'))!
                  .slice(5)
              : raw,
          )
        const value = parsed.result?.structuredContent ?? parsed.error ?? JSON.parse(parsed.result?.content?.[0]?.text ?? '{}')
        const failed = !response.ok || parsed.error != null || parsed.result?.isError
        if (failed) stderr = JSON.stringify(value)
        else stdout = JSON.stringify(value)
        record = {
          id,
          args: [name, JSON.stringify(args)],
          category: name == 'flow_edit' ? 'edit' : name == 'flow_check' ? 'check' : 'read',
          startedAt: new Date(Date.now() - (performance.now() - started)).toISOString(),
          durationMs: Math.max(0, performance.now() - started - excludedMs),
          exitCode: failed ? 1 : 0,
          argumentBytes: Buffer.byteLength(`${name} ${JSON.stringify(args)}`),
          inputs: [],
          stdoutBytes: Buffer.byteLength(stdout),
          stderrBytes: Buffer.byteLength(stderr),
          requests: [
            {
              method: 'POST',
              path: '/v1/mcp',
              status: response.status,
              durationMs: Math.max(0, performance.now() - started - excludedMs),
              inputBytes: Buffer.byteLength(body),
              outputBytes: Buffer.byteLength(raw),
              ...(args.requestId == null
                ? {}
                : {
                    retryIdentity: createHash('sha256')
                      .update(JSON.stringify([name, args]))
                      .digest('hex'),
                  }),
            },
          ],
        }
      }
      ;(lab.attempt.endedAt == null ? lab.attempt.commands : lab.attempt.after).push(record)
      await writeFile(path.join(lab.directory, `${lab.attempt.id}.${id}.stdout`), stdout)
      await writeFile(path.join(lab.directory, `${lab.attempt.id}.${id}.stderr`), stderr)
      await lab.persist()
      const result = JSON.parse(record.exitCode == 0 || stderr.length == 0 ? stdout : stderr) as Record<string, unknown>
      if (record.exitCode != 0) throw new Error(JSON.stringify(result))
      return result
    } finally {
      lab.active.delete(id)
    }
  }
}
