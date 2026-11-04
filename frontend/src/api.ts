export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public requestId: string | null = null,
  ) {
    super(message);
  }
}
export function headers(): Record<string, string> {
  const key = sessionStorage.getItem("talentos-key");
  return key ? { Authorization: `Bearer ${key}` } : {};
}
export async function request(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.body instanceof FormData ? 150_000 : 30_000,
  );
  const forwardedAbort = () => controller.abort();
  options.signal?.addEventListener("abort", forwardedAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
    const merged = new Headers(headers());
    new Headers(options.headers).forEach((value, key) =>
      merged.set(key, value),
    );
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: merged,
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const body = await response.json();
        message =
          typeof body.detail === "string"
            ? body.detail
            : body.detail
                ?.map((item: { msg: string }) => item.msg)
                .join("; ") || message;
      } catch {
        /* Preserve the HTTP status when a proxy returns HTML. */
      }
      if (response.status === 401 && sessionStorage.getItem("talentos-key")) {
        sessionStorage.removeItem("talentos-key");
        window.dispatchEvent(new Event("talentos:locked"));
      }
      throw new ApiError(
        message,
        response.status,
        response.headers.get("x-request-id"),
      );
    }
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new ApiError(
        "The request timed out or was cancelled. Refresh the workspace before retrying a change.",
        0,
      );
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardedAbort);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await request(path, options);
  return response.status === 204 ? (undefined as T) : response.json();
}
export const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
