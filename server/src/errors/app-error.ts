import {
  appErrorMessage,
  type AppErrorCode,
  type AppErrorDetails,
} from '../../../shared/app-errors';

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    readonly details: AppErrorDetails = {},
    readonly statusCode = 400,
  ) {
    super(appErrorMessage(code, details));
    this.name = 'AppError';
  }
}
