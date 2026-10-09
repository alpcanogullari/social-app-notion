const apiOrigin = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export function apiUrl(url: string): string {
  return url.startsWith("/") ? `${apiOrigin}${url}` : url;
}

export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(apiUrl(url), {
    ...options,
    credentials: "include",
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Could not complete the request.");
  return data as T;
}
