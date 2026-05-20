const TOKEN_KEY = "poly-shine-api-token";

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? import.meta.env.VITE_API_TOKEN ?? "";
}

export function setStoredToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers: HeadersInit = {
    ...(init?.headers as Record<string, string>),
  };
  if (init?.body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = data as { error?: string };
    throw new ApiError(err?.error ?? res.statusText, res.status, data);
  }
  return data as T;
}
