export class UserFacingError extends Error {
  public readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'UserFacingError';
    this.exitCode = exitCode;
  }
}
