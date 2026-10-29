export class WorkflowToolError extends Error {
  readonly retryable = false
  get catchable(): boolean {
    return !this.indeterminate
  }
  get indeterminate(): boolean {
    return this.code == 'workflow.indeterminate'
  }
  constructor(
    readonly code: 'workflow.failed' | 'workflow.canceled' | 'workflow.indeterminate' | 'workflow.unavailable',
    message: string,
  ) {
    super(message)
    this.name = 'WorkflowToolError'
  }
}
