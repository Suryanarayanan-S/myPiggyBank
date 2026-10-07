export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function notFound(what = 'Resource'): AppError {
  return new AppError(404, 'NOT_FOUND', `${what} not found`);
}
