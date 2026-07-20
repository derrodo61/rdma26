import { appErrorMessage, type AppErrorResponse } from '../../../shared/app-errors';
import { AppError } from '../errors/app-error';

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Request failed.';
}

export function appErrorResponse(error: unknown): AppErrorResponse {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: appErrorMessage(error.code, error.details),
      details: error.details,
    };
  }

  return {
    code: 'REQUEST_FAILED',
    message: getErrorMessage(error),
  };
}
