export class OperationTimeoutError extends Error {
  constructor(operation: string) {
    super(`${operation} timed out`)
    this.name = "OperationTimeoutError"
  }
}

export async function withOperationTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new OperationTimeoutError(label)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
