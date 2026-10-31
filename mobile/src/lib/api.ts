import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
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

export const DEFAULT_API_BASE = defaultBaseUrl();

// Demo builds talk to a laptop on the local Wi-Fi, whose address changes from venue to venue, so the server
// can be changed on the sign-in screen and is remembered on the device. Builds that point at an https API
// keep it fixed: credentials only ever go to the server the build was made for.
export const SERVER_EDITABLE = DEFAULT_API_BASE.startsWith("http://");
const SERVER_KEY = "saathi.server";
let apiBase = DEFAULT_API_BASE;
export const getApiBase = () => apiBase;

const serverStore = {
  get: async () => (Platform.OS === "web" ? globalThis.localStorage?.getItem(SERVER_KEY) ?? null : SecureStore.getItemAsync(SERVER_KEY)),
  set: async (v: string) => (Platform.OS === "web" ? globalThis.localStorage?.setItem(SERVER_KEY, v) : SecureStore.setItemAsync(SERVER_KEY, v)),
  clear: async () => (Platform.OS === "web" ? globalThis.localStorage?.removeItem(SERVER_KEY) : SecureStore.deleteItemAsync(SERVER_KEY)),
};

export async function loadApiBase() {
  if (!SERVER_EDITABLE) return;
  try {
    apiBase = (await serverStore.get()) ?? DEFAULT_API_BASE;
  } catch {
    apiBase = DEFAULT_API_BASE;
  }
}

/** "192.168.1.5", "192.168.1.5:8000" or a full URL -> "http://192.168.1.5:8000". Null when it isn't an address.
 * Parsed by hand: React Native's URL has no hostname/port. */
export function normalizeServer(input: string): string | null {
  const m = /^(?:(https?):\/\/)?([a-z0-9.-]+)(?::(\d{1,5}))?\/?$/i.exec(input.trim());
  if (!m || !/[a-z0-9]/i.test(m[2]) || m[2].startsWith(".") || m[2].endsWith(".")) return null;
  const scheme = (m[1] ?? "http").toLowerCase();
  const port = m[3] ?? (scheme === "https" ? "443" : "8000");
  if (Number(port) < 1 || Number(port) > 65535) return null;
  return `${scheme}://${m[2].toLowerCase()}:${port}`;
}

/** Checks the address answers as a Saathi API before saving it. */
export async function changeApiBase(input: string): Promise<string> {
  if (!SERVER_EDITABLE) throw new ApiError(0, "LOCKED", "This build always uses its own server");
  const url = normalizeServer(input);
  if (!url) throw new ApiError(0, "BAD_ADDRESS", "Enter an address like 192.168.1.5:8000");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    const body = (await res.json()) as { status?: string };
    if (!res.ok || body.status !== "ok") throw new Error("not saathi");
  } catch {
    throw new ApiError(0, "UNREACHABLE", `No Saathi server at ${url.replace(/^https?:\/\//, "")}. Same Wi-Fi as the laptop?`);
  } finally {
    clearTimeout(timer);
  }
  apiBase = url;
  if (url === DEFAULT_API_BASE) await serverStore.clear();
  else await serverStore.set(url);
  return url;
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setToken(value: string | null) {
  token = value;
}
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

const TIMEOUT_MS = 15000;
const SESSION_ERRORS = new Set(["UNAUTHENTICATED", "SESSION_EXPIRED"]);
// Calls that wait on Sarvam (speech, translation, document reading) or plan building get more time, so the
// app never reports a timeout for work the server then completes.
const SLOW_MS = 45000;
const BILL_MS = 75000;

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {},
  timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    res = await fetch(`${apiBase}${path}`, {
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
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A proxy or host error page (HTML), e.g. a 502 during a deploy.
    if (res.ok) throw new ApiError(res.status, "BAD_RESPONSE", "Unexpected response from the server");
    throw new ApiError(res.status, "SERVER_UNAVAILABLE", "Saathi is temporarily unavailable. Please try again.");
  }
  if (!res.ok) {
    // Only a dead session signs the user out; a wrong password on a form (also 401) must not.
    if (res.status === 401 && onUnauthorized && SESSION_ERRORS.has(data?.code)) onUnauthorized();
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
  sourcing: (productId: string) => request<S["SourcingOut"]>("GET", `/api/v1/products/${productId}/sourcing`),
  buy: (quoteId: string, packs: number, sellPrice: string) =>
    request<TaskDetail>("POST", "/api/v1/purchases", { quote_id: quoteId, packs, sell_price: sellPrice }),
  profit: () => request<S["ProfitReport"]>("GET", "/api/v1/profit"),
  invoices: () => request<Invoice[]>("GET", "/api/v1/invoices"),
  orders: () => request<Order[]>("GET", "/api/v1/orders"),
  approvals: () => request<Approval[]>("GET", "/api/v1/approvals"),
  connections: () => request<Connection[]>("GET", "/api/v1/connections"),
  audit: (cursor?: string) => request<S["Page"]>("GET", `/api/v1/audit?limit=50${cursor ? `&cursor=${cursor}` : ""}`),
  ask: (text: string, confirmed_budget?: string, speak = false) =>
    request<AssistantResponse>("POST", "/api/v1/assistant/message", { text, confirmed_budget, speak }, {}, SLOW_MS),
  askVoiceLang: (form: FormData, language: string) =>
    request<AssistantResponse>("POST", `/api/v1/assistant/voice?language=${encodeURIComponent(language)}`, form, {}, SLOW_MS),
  // One key per tap sequence: a retry of the same tap reuses it so it can never double-order.
  confirm: (approvalId: string, key: string = newKey(), pin?: string) =>
    request<TaskDetail>("POST", `/api/v1/approvals/${approvalId}/confirm`, undefined,
      pin ? { "Idempotency-Key": key, "X-Approval-Pin": pin } : { "Idempotency-Key": key }, SLOW_MS),
  setApprovalPin: (password: string, pin: string | null) =>
    request<SimpleResult>("POST", "/api/v1/me/approval-pin", { password, pin }),
  reject: (approvalId: string) => request<TaskDetail>("POST", `/api/v1/approvals/${approvalId}/reject`),
  readback: (taskId: string, lang: "hi-IN" | "en-IN", audio = false) =>
    request<S["ReadbackOut"]>("GET", `/api/v1/tasks/${taskId}/readback?lang=${lang}&audio=${audio}`, undefined, {}, SLOW_MS),
  renewApproval: (taskId: string) => request<TaskDetail>("POST", `/api/v1/tasks/${taskId}/renew-approval`),
  replan: (taskId: string) => request<TaskDetail>("POST", `/api/v1/tasks/${taskId}/replan`),
  recheckPayment: (invoiceId: string) => request<SimpleResult>("POST", `/api/v1/invoices/${invoiceId}/recheck`),
  notReceived: (invoiceId: string) => request<SimpleResult>("POST", `/api/v1/invoices/${invoiceId}/not-received`),
  withdrawLink: (invoiceId: string) => request<SimpleResult>("POST", `/api/v1/invoices/${invoiceId}/withdraw-link`),
  paymentLink: (invoiceId: string) => request<TaskDetail>("POST", `/api/v1/invoices/${invoiceId}/payment-link`),
  demoReset: () => request<SimpleResult>("POST", "/api/v1/demo/reset", undefined, {}, SLOW_MS),
  demoDelivery: (taskId: string) => request<TaskDetail>("POST", `/api/v1/demo/tasks/${taskId}/simulate-delivery`),
  demoPayment: (invoiceId: string, amount?: string) =>
    request<SimpleResult>("POST", `/api/v1/demo/simulate-payment/${invoiceId}`, amount ? { amount } : {}),
  growth: () => request<GrowthOverview>("GET", "/api/v1/growth/overview"),
  festival: () => request<Festival | null>("GET", "/api/v1/growth/festival"),
  impact: () => request<Impact>("GET", "/api/v1/growth/impact"),
  briefSpeech: (lang: string, audio: boolean) =>
    request<Speech>("GET", `/api/v1/brief/speech?lang=${lang}&audio=${audio}`, undefined, {}, SLOW_MS),
  languages: () => request<Language[]>("GET", "/api/v1/languages"),
  slowMovers: () => request<SlowMover[]>("GET", "/api/v1/growth/slow-movers"),
  offers: () => request<Offer[]>("GET", "/api/v1/offers"),
  createOffer: (productId: string, discount: number) =>
    request<Offer>("POST", "/api/v1/offers", { product_id: productId, discount_pct: discount }),
  offerShared: (id: string) => request<Offer>("POST", `/api/v1/offers/${id}/shared`),
  translate: (kind: "OFFER" | "INVOICE" | "KHATA", ref: string, target: string) =>
    request<S["TranslateOut"]>("POST", "/api/v1/translate", { kind, ref, target }, {}, SLOW_MS),
  khata: () => request<Khata>("GET", "/api/v1/khata"),
  cashflow: (includePending = true) => request<Cashflow>("GET", `/api/v1/cashflow?include_pending=${includePending}`),
  businessSettings: () => request<BusinessSettings>("GET", "/api/v1/settings/business"),
  saveBusinessSettings: (body: { cash_on_hand?: string; weekly_expenses?: string; default_restock_budget?: string }) =>
    request<BusinessSettings>("POST", "/api/v1/settings/business", body),
  benchmarks: () => request<Benchmarks>("GET", "/api/v1/benchmarks"),
  scan: () => request<Scan>("POST", "/api/v1/agent/scan", undefined, {}, SLOW_MS),
  bills: () => request<Receipt[]>("GET", "/api/v1/bills"),
  billFromText: (text: string) => request<Receipt>("POST", "/api/v1/bills/text", { text }),
  billFromPhoto: (form: FormData) => request<Receipt>("POST", "/api/v1/bills/scan", form, {}, BILL_MS),
  confirmBill: (id: string, lines: { product_id: string; packs: number; unit_price: string | null }[], supplier?: string) =>
    request<Receipt>("POST", `/api/v1/bills/${id}/confirm`, { lines, supplier_name: supplier ?? null }),
  discardBill: (id: string) => request<Receipt>("POST", `/api/v1/bills/${id}/discard`),
  addProduct: (body: S["ProductIn"]) => request<S["InventoryItem"]>("POST", "/api/v1/products", body),
  billNewItem: (id: string, body: S["NewBillItemIn"]) => request<Receipt>("POST", `/api/v1/bills/${id}/new-item`, body),
  soundboxToday: () => request<S["SoundboxToday"]>("GET", "/api/v1/soundbox/today"),
  soundboxUndo: (saleId: string) => request<S["CounterSaleOut"]>("POST", `/api/v1/soundbox/sales/${saleId}/undo`),
  live: (after: number | null, wait = 25) =>
    request<S["LiveOut"]>("GET", `/api/v1/live?wait=${wait}${after == null ? "" : `&after=${after}`}`, undefined, {}, (wait + 10) * 1000),
  newKey,
};
