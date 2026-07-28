import { supabase } from "@/integrations/supabase/client";

export class FunctionInvokeError extends Error {
  status?: number;
  body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "FunctionInvokeError";
    this.status = status;
    this.body = body;
  }
}

const statusFallback = (status?: number) => {
  if (status === 400) return "The request was rejected. Please check the values you entered.";
  if (status === 401) return "Your session expired — please sign in again.";
  if (status === 403) return "You don't have permission to do this.";
  if (status === 404) return "The requested item could not be found.";
  if (status === 409) return "That record already exists.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status && status >= 500) return "The server ran into a problem. Please try again.";
  return "The request failed. Please try again.";
};

const pickMessage = (body: any): string | null => {
  if (!body) return null;
  if (typeof body === "string") return body.trim() ? body.trim().slice(0, 500) : null;
  const candidate = body.error ?? body.message ?? body.msg ?? body.error_description;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  if (candidate && typeof candidate === "object") {
    try {
      return JSON.stringify(candidate).slice(0, 500);
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * Reads the real error message out of a supabase-js FunctionsHttpError.
 *
 * `supabase.functions.invoke` returns an error whose message is always the
 * useless string "Edge Function returned a non-2xx status code"; the actual
 * JSON body lives on `error.context` (a Response).
 */
export async function normalizeFunctionError(error: any): Promise<FunctionInvokeError> {
  if (error instanceof FunctionInvokeError) return error;

  const ctx: Response | undefined = error?.context;
  if (ctx && typeof ctx === "object" && typeof (ctx as any).clone === "function") {
    const status = (ctx as Response).status;
    let body: unknown = null;
    try {
      body = await (ctx as Response).clone().json();
    } catch {
      try {
        body = await (ctx as Response).clone().text();
      } catch {
        body = null;
      }
    }
    const message = pickMessage(body) || statusFallback(status);
    return new FunctionInvokeError(message, status, body);
  }

  const raw = String(error?.message || "");
  if (/failed to fetch|networkerror|relay|load failed/i.test(raw)) {
    return new FunctionInvokeError("Couldn't reach the server. Check your connection and try again.");
  }
  if (/non-2xx/i.test(raw)) {
    return new FunctionInvokeError(statusFallback(error?.status));
  }
  return new FunctionInvokeError(raw || "The request failed. Please try again.", error?.status);
}

type InvokeOptions = Parameters<typeof supabase.functions.invoke>[1];

/**
 * Invoke an edge function and throw a FunctionInvokeError carrying the real
 * server-provided message (and HTTP status) instead of a generic one.
 * Also surfaces `{ success: false, error }` bodies returned with a 200.
 */
export async function invokeFunction<T = any>(name: string, options?: InvokeOptions): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, options);
  if (error) throw await normalizeFunctionError(error);
  if (data && typeof data === "object" && "success" in (data as any) && !(data as any).success) {
    throw new FunctionInvokeError(pickMessage(data) || "The request failed. Please try again.", 200, data);
  }
  return data as T;
}
