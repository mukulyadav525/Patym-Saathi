import type { components } from "@shared/api-types";

export type S = components["schemas"];
export type TaskDetail = S["TaskDetail"];
export type TaskSummary = S["TaskSummary"];
export type LoginResponse = S["LoginResponse"];

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const setToken = (t: string | null) => (token = t);
export const setUnauthorizedHandler = (h: () => void) => (onUnauthorized = h);

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the Saathi API. Is it running?");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, data?.code ?? "ERROR", data?.message ?? "Something went wrong");
  }
  return data as T;
}

export const newKey = () => crypto.randomUUID();

export const api = {
  login: (email: string, password: string) => request<LoginResponse>("POST", "/api/v1/auth/login", { email, password }),
  dashboard: () => request<S["DashboardOut"]>("GET", "/api/v1/dashboard"),
  tasks: () => request<TaskSummary[]>("GET", "/api/v1/tasks"),
  task: (id: string) => request<TaskDetail>("GET", `/api/v1/tasks/${id}`),
  inventory: () => request<S["InventoryItem"][]>("GET", "/api/v1/inventory"),
  invoices: () => request<S["InvoiceOut"][]>("GET", "/api/v1/invoices"),
  orders: () => request<S["OrderOut"][]>("GET", "/api/v1/orders"),
  approvals: () => request<S["ApprovalOut"][]>("GET", "/api/v1/approvals"),
  connections: () => request<S["ConnectionOut"][]>("GET", "/api/v1/connections"),
  tools: () => request<S["ToolOut"][]>("GET", "/api/v1/tools"),
  audit: (cursor?: string) => request<S["Page"]>("GET", `/api/v1/audit?limit=100${cursor ? `&cursor=${cursor}` : ""}`),
  ask: (text: string) => request<S["AssistantResponse"]>("POST", "/api/v1/assistant/message", { text }),
  confirm: (approvalId: string, key: string) =>
    request<TaskDetail>("POST", `/api/v1/approvals/${approvalId}/confirm`, undefined, { "Idempotency-Key": key }),
  reject: (approvalId: string) => request<TaskDetail>("POST", `/api/v1/approvals/${approvalId}/reject`),
  paymentLink: (invoiceId: string) => request<TaskDetail>("POST", `/api/v1/invoices/${invoiceId}/payment-link`),
  demoReset: () => request<S["SimpleResult"]>("POST", "/api/v1/demo/reset"),
  demoDelivery: (taskId: string) => request<TaskDetail>("POST", `/api/v1/demo/tasks/${taskId}/simulate-delivery`),
  demoPayment: (invoiceId: string) => request<S["SimpleResult"]>("POST", `/api/v1/demo/simulate-payment/${invoiceId}`, {}),
};

export const rupees = (v: string | number | null | undefined, d = 0) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
