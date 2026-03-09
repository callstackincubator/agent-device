const canceledRequestIds = new Set<string>();
const requestAbortControllers = new Map<string, AbortController>();

export function registerRequestAbort(requestId: string | undefined): void {
  if (!requestId) return;
  const controller = new AbortController();
  requestAbortControllers.set(requestId, controller);
  if (canceledRequestIds.has(requestId)) {
    controller.abort();
  }
}

export function markRequestCanceled(requestId: string | undefined): void {
  if (!requestId) return;
  canceledRequestIds.add(requestId);
  requestAbortControllers.get(requestId)?.abort();
}

export function clearRequestCanceled(requestId: string | undefined): void {
  if (!requestId) return;
  canceledRequestIds.delete(requestId);
  requestAbortControllers.delete(requestId);
}

export function isRequestCanceled(requestId: string | undefined): boolean {
  if (!requestId) return false;
  return canceledRequestIds.has(requestId);
}

export function getRequestSignal(requestId: string | undefined): AbortSignal | undefined {
  if (!requestId) return undefined;
  return requestAbortControllers.get(requestId)?.signal;
}
