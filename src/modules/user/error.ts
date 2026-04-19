export class UserError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number = 400,
    public meta?: unknown
  ) {
    super(message);
    this.name = 'AppError';

    Object.setPrototypeOf(this, new.target.prototype);
  }
}