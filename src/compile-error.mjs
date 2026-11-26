export class CompileError extends Error {
  constructor(message, where) {
    super('error: ' + message + (where ? ' at ' + where.line + ':' + where.col : ''));
    this.name = 'CompileError';
  }
}
