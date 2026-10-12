class AppError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'AppError';
    this.code = code;
  }
}

function appError(code, message, extra) {
  const error = new AppError(code, message);
  error.retryable = extra?.retryable === true;
  error.targetId = extra?.targetId || null;
  return error;
}

function asAppError(error, fallback = 'INVALID_ARGUMENT') {
  if (error instanceof AppError) return error;
  const wrapped = new AppError(error?.code || fallback, error?.message || '操作失败');
  wrapped.retryable = error?.retryable === true;
  wrapped.targetId = error?.targetId || null;
  return wrapped;
}

function publicError(error, fallback = 'INVALID_ARGUMENT') {
  const wrapped = asAppError(error, fallback);
  return {
    ok: false,
    code: wrapped.code,
    message: wrapped.message,
    retryable: wrapped.retryable === true,
    targetId: wrapped.targetId || null
  };
}

module.exports = { AppError, appError, asAppError, publicError };
