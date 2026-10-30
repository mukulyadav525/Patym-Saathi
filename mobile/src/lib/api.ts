import Constants from "expo-constants";
import { Platform } from "react-native";

import type { components } from "@shared/api-types";

export type S = components["schemas"];
export type TaskDetail = S["TaskDetail"];
export type TaskSummary = S["TaskSummary"];
export type Dashboard = S["DashboardOut"];
export type Invoice = S["InvoiceOut"];
export type InventoryItem = S["InventoryItem"];
export type Order = S["OrderOut"];
export type AuditEvent = S["AuditOut"];
export type Brief = S["Brief"];
export type AssistantResponse = S["AssistantResponse"];
export type LoginResponse = S["LoginResponse"];
export type Connection = S["ConnectionOut"];
export type Approval = S["ApprovalOut"];
export type SimpleResult = S["SimpleResult"];
export type GrowthOverview = S["GrowthOverview"];
export type Festival = S["FestivalOut"];
export type Impact = S["ImpactOut"];
export type SlowMover = S["SlowMoverOut"];
export type Offer = S["OfferOut"];
export type Khata = S["KhataOut"];
export type KhataCustomer = S["KhataCustomer"];
export type Cashflow = S["CashflowOut"];
export type BusinessSettings = S["BusinessSettingsOut"];
export type Benchmarks = S["BenchmarksOut"];
export type Speech = S["SpeechOut"];
export type Scan = S["ScanOut"];
export type Receipt = S["ReceiptOut"];
export type Language = S["LanguageOut"];

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

function defaultBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (Platform.OS === "web") return "http://localhost:8000";
  // Dev: reach the API on the same machine that serves the Expo bundle.
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host ? `http://${host}:8000` : "http://10.0.2.2:8000";
}

export const API_BASE = defaultBaseUrl();

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setToken(value: string | null) {
  token = value;
}
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

const TIMEOUT_MS = 15000;

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    res = await fetch(`${API_BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(isForm || body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", controller.signal.aborted ? "The server took too long to respond" : "Can't reach Saathi. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, data?.code ?? "ERROR", data?.message ?? "Something went wrong", data?.details ?? {});
  }
  return data as T;
}

const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export const api = {
  login: (email: string, password: string) => request<LoginResponse>("POST", "/api/v1/auth/login", { email, password }),
  me: () => request<LoginResponse>("GET", "/api/v1/me"),
  dashboard: () => request<Dashboard>("GET", "/api/v1/dashboard"),
  brief: () => request<Brief>("GET", "/api/v1/brief"),
  tasks: () => request<TaskSummary[]>("GET", "/api/v1/tasks"),
  task: (id: string) => request<TaskDetail>("GET", `/api/v1/tasks/${id}`),
  inventory: () => request<InventoryItem[]>("GET", "/api/v1/inventory"),
  invoices: () => request<Invoice[]>("GET", "/api/v1/invoices"),
  orders: () => request<Order[]>("GET", "/api/v1/orders"),
  approvals: () => request<Approval[]>("GET", "/api/v1/approvals"),
  connections: () => request<Connection[]>("GET", "/api/v1/connections"),
  audit: (cursor?: string) => request<S["Page"]>("GET", `/api/v1/audit?limit=50${cursor ? `&cursor=${cursor}` : ""}`),
  ask: (text: string, confirmed_budget?: string) =>
    request<AssistantResponse>("POST", "/api/v1/assistant/message", { text, confirmed_budget }),
  askVoiceLang: (form: FormData, language: string) =>
    request<AssistantResponse>("POST", `/api/v1/assistant/voice?language=${encodeURIComponent(language)}`, form),
  // One key per tap sequence: a retry of the same tap reuses it so it can never double-order.
  confirm: (approvalId: string, key: string = newKey(), pin?: string) =>
    request<TaskDetail>("POST", `/api/v1/approvals/${approvalId}/confirm`, undefined,
      pin ? { "Idempotency-Key": key, "X-Approval-Pin": pin } : { "Idempotency-Key": key }),
  setApprovalPin: (password: string, pin: string | null) =>
    request<SimpleResult>("POST", "/api/v1/me/approval-pin", { password, pin }),
  reject: (approvalId: string) => request<TaskDetail>("POST", `/api/v1/approvals/${approvalId}/reject`),
  readback: (taskId: string, lang: "hi-IN" | "en-IN", audio = false) =>
    request<S["ReadbackOut"]>("GET", `/api/v1/tasks/${taskId}/readback?lang=${lang}&audio=${audio}`),
  renewApproval: (taskId: string) => request<TaskDetail>("POST", `/api/v1/tasks/${taskId}/renew-approval`),
  replan: (taskId: string) => request<TaskDetail>("POST", `/api/v1/tasks/${taskId}/replan`),
  paymentLink: (invoiceId: string) => request<TaskDetail>("POST", `/api/v1/invoices/${invoiceId}/payment-link`),
  demoReset: () => request<SimpleResult>("POST", "/api/v1/demo/reset"),
  demoDelivery: (taskId: string) => request<TaskDetail>("POST", `/api/v1/demo/tasks/${taskId}/simulate-delivery`),
  demoPayment: (invoiceId: string, amount?: string) =>
    request<SimpleResult>("POST", `/api/v1/demo/simulate-payment/${invoiceId}`, amount ? { amount } : {}),
  growth: () => request<GrowthOverview>("GET", "/api/v1/growth/overview"),
  festival: () => request<Festival | null>("GET", "/api/v1/growth/festival"),
  impact: () => request<Impact>("GET", "/api/v1/growth/impact"),
  briefSpeech: (lang: string, audio: boolean) =>
    request<Speech>("GET", `/api/v1/brief/speech?lang=${lang}&audio=${audio}`),
  languages: () => request<Language[]>("GET", "/api/v1/languages"),
  slowMovers: () => request<SlowMover[]>("GET", "/api/v1/growth/slow-movers"),
  offers: () => request<Offer[]>("GET", "/api/v1/offers"),
  createOffer: (productId: string, discount: number) =>
    request<Offer>("POST", "/api/v1/offers", { product_id: productId, discount_pct: discount }),
  offerShared: (id: string) => request<Offer>("POST", `/api/v1/offers/${id}/shared`),
  translate: (kind: "OFFER" | "INVOICE" | "KHATA", ref: string, target: string) =>
    request<S["TranslateOut"]>("POST", "/api/v1/translate", { kind, ref, target }),
  khata: () => request<Khata>("GET", "/api/v1/khata"),
  cashflow: (includePending = true) => request<Cashflow>("GET", `/api/v1/cashflow?include_pending=${includePending}`),
  businessSettings: () => request<BusinessSettings>("GET", "/api/v1/settings/business"),
  saveBusinessSettings: (body: { cash_on_hand?: string; weekly_expenses?: string; default_restock_budget?: string }) =>
    request<BusinessSettings>("POST", "/api/v1/settings/business", body),
  benchmarks: () => request<Benchmarks>("GET", "/api/v1/benchmarks"),
  scan: () => request<Scan>("POST", "/api/v1/agent/scan"),
  bills: () => request<Receipt[]>("GET", "/api/v1/bills"),
  billFromText: (text: string) => request<Receipt>("POST", "/api/v1/bills/text", { text }),
  billFromPhoto: (form: FormData) => request<Receipt>("POST", "/api/v1/bills/scan", form),
  confirmBill: (id: string, lines: { product_id: string; packs: number; unit_price: string | null }[], supplier?: string) =>
    request<Receipt>("POST", `/api/v1/bills/${id}/confirm`, { lines, supplier_name: supplier ?? null }),
  discardBill: (id: string) => request<Receipt>("POST", `/api/v1/bills/${id}/discard`),
  newKey,
};
