export const copy = {
  apiErrors: {
    bad_request: "The request could not be accepted.",
    unauthorized: "The server requires a valid API key.",
    forbidden: "This action is not allowed.",
    not_found: "This item could not be found.",
    method_not_allowed: "This action is not supported.",
    request_too_large: "The request is too large.",
    request_validation_error: "Check the supplied fields and try again.",
    invalid_cursor: "This list changed. Refresh it and try again.",
    rate_limited: "Too many requests. Try again shortly.",
    internal_error: "The server could not complete this action.",
    service_unavailable: "The server is busy. Try again shortly.",
  },
  toast: {
    requestFailed: (status: number, detail: string) => `Request failed (${status}): ${detail}`,
    requestFailedWithoutDetail: (status: number) => `Request failed (${status})`,
    somethingWentWrong: "Something went wrong.",
  },
} as const;
