export class WorkflowToolError extends Error {
  readonly code: 'workflow.failed' | 'workflow.canceled' | 'workflow.indeterminate' | 'workflow.unavailable'
  readonly retryable = false
  get catchable(): boolean {
    return !this.indeterminate
  }
  get indeterminate(): boolean {
    return this.code == 'workflow.indeterminate'
  }
  constructor(code: WorkflowToolError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'WorkflowToolError'
  }
}
