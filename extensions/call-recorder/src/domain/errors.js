/** An error the UI can show as is. The code lets callers branch without parsing text. */
export class AppError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "AppError";
  }
}
export function messageOf(e) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * @typedef {"consent-required" | "busy" | "not-found" | "no-encoder" | "capture-failed" | "cancelled" | "save-failed"} ErrorCode
 */
