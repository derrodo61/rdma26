import { HttpErrorResponse } from '@angular/common/http';

import { formatAppErrorResponse, type AppErrorResponse } from '../../../shared/app-errors';

export function getApiErrorMessage(error: unknown, fallback = 'Request failed.'): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as Partial<AppErrorResponse> | null;

    if (isAppErrorResponse(body)) {
      return formatAppErrorResponse(body);
    }

    if (body && typeof body === 'object' && typeof body.message === 'string') {
      return body.message;
    }

    return fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function isAppErrorResponse(value: Partial<AppErrorResponse> | null): value is AppErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.code === 'string' &&
    typeof value.message === 'string'
  );
}
