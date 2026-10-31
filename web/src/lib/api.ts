import type { components } from "@shared/api-types";

export type S = components["schemas"];
export type TaskDetail = S["TaskDetail"];
export type TaskSummary = S["TaskSummary"];
export type LoginResponse = S["LoginResponse"];
export type Dashboard = S["DashboardOut"];

// Same origin by default: Next.js forwards /api/v1 to the FastAPI server (next.config.ts). One origin means the
// iPad Soundbox works over https on the shop Wi-Fi with no mixed content or CORS. A deployment where the API
// lives elsewhere sets NEXT_PUBLIC_API_BASE_URL.
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const setToken = (t: string | null) => (token = t);
export const setUnauthorizedHandler = (h: () => void) => (onUnauthorized = h);

// Calls that wait on Sarvam or build plans get more time than the 15 s default.
const SLOW_MS = 45000;

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {},
  timeoutMs?: number): Promise<T> {
  let res: Response;
  const isForm = body instanceof FormData;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs ?? (isForm ? 75000 : 15000)),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the Saathi API. Is it running?");
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
    if (res.status === 401 && (data?.code === "UNAUTHENTICATED" || data?.code === "SESSION_EXPIRED")) onUnauthorized?.();
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
  ask: (text: string, speak = false) =>
    request<S["AssistantResponse"]>("POST", "/api/v1/assistant/message", { text, speak }, {}, SLOW_MS),
  renewApproval: (taskId: string) => request<TaskDetail>("POST", `/api/v1/tasks/${taskId}/renew-approval`),
  confirm: (approvalId: string, key: string, pin?: string) =>
    request<TaskDetail>("POST", `/api/v1/approvals/${approvalId}/confirm`, undefined,
      pin ? { "Idempotency-Key": key, "X-Approval-Pin": pin } : { "Idempotency-Key": key }, SLOW_MS),
  reject: (approvalId: string) => request<TaskDetail>("POST", `/api/v1/approvals/${approvalId}/reject`),
  recheckPayment: (invoiceId: string) => request<S["SimpleResult"]>("POST", `/api/v1/invoices/${invoiceId}/recheck`),
  notReceived: (invoiceId: string) => request<S["SimpleResult"]>("POST", `/api/v1/invoices/${invoiceId}/not-received`),
  withdrawLink: (invoiceId: string) => request<S["SimpleResult"]>("POST", `/api/v1/invoices/${invoiceId}/withdraw-link`),
  paymentLink: (invoiceId: string) => request<TaskDetail>("POST", `/api/v1/invoices/${invoiceId}/payment-link`),
  demoReset: () => request<S["SimpleResult"]>("POST", "/api/v1/demo/reset", undefined, {}, SLOW_MS),
  demoDelivery: (taskId: string) => request<TaskDetail>("POST", `/api/v1/demo/tasks/${taskId}/simulate-delivery`),
  demoPayment: (invoiceId: string) => request<S["SimpleResult"]>("POST", `/api/v1/demo/simulate-payment/${invoiceId}`, {}),
  growth: () => request<S["GrowthOverview"]>("GET", "/api/v1/growth/overview"),
  briefSpeech: (lang: string, audio: boolean) => request<S["SpeechOut"]>("GET", `/api/v1/brief/speech?lang=${lang}&audio=${audio}`, undefined, {}, SLOW_MS),
  slowMovers: () => request<S["SlowMoverOut"][]>("GET", "/api/v1/growth/slow-movers"),
  offers: () => request<S["OfferOut"][]>("GET", "/api/v1/offers"),
  createOffer: (productId: string, discount: number) =>
    request<S["OfferOut"]>("POST", "/api/v1/offers", { product_id: productId, discount_pct: discount }),
  offerShared: (id: string) => request<S["OfferOut"]>("POST", `/api/v1/offers/${id}/shared`),
  translate: (kind: "OFFER" | "INVOICE" | "KHATA", ref: string, target: string) =>
    request<S["TranslateOut"]>("POST", "/api/v1/translate", { kind, ref, target }, {}, SLOW_MS),
  khata: () => request<S["KhataOut"]>("GET", "/api/v1/khata"),
  cashflow: (includePending = true) => request<S["CashflowOut"]>("GET", `/api/v1/cashflow?include_pending=${includePending}`),
  businessSettings: () => request<S["BusinessSettingsOut"]>("GET", "/api/v1/settings/business"),
  saveBusinessSettings: (body: { cash_on_hand?: string; weekly_expenses?: string; default_restock_budget?: string }) =>
    request<S["BusinessSettingsOut"]>("POST", "/api/v1/settings/business", body),
  benchmarks: () => request<S["BenchmarksOut"]>("GET", "/api/v1/benchmarks"),
  scan: () => request<S["ScanOut"]>("POST", "/api/v1/agent/scan", undefined, {}, SLOW_MS),
  bills: () => request<S["ReceiptOut"][]>("GET", "/api/v1/bills"),
  billFromText: (text: string) => request<S["ReceiptOut"]>("POST", "/api/v1/bills/text", { text }),
  billFromPhoto: (form: FormData) => request<S["ReceiptOut"]>("POST", "/api/v1/bills/scan", form),
  confirmBill: (id: string, lines: { product_id: string; packs: number; unit_price: string | null }[]) =>
    request<S["ReceiptOut"]>("POST", `/api/v1/bills/${id}/confirm`, { lines }),
  discardBill: (id: string) => request<S["ReceiptOut"]>("POST", `/api/v1/bills/${id}/discard`),
  addProduct: (body: S["ProductIn"]) => request<S["InventoryItem"]>("POST", "/api/v1/products", body),
  billNewItem: (id: string, body: S["NewBillItemIn"]) => request<S["ReceiptOut"]>("POST", `/api/v1/bills/${id}/new-item`, body),
  soundboxListen: (form: FormData) => request<S["SoundboxResult"]>("POST", "/api/v1/soundbox/listen", form, {}, SLOW_MS),
  soundboxText: (text: string, followup = false, speak = true) =>
    request<S["SoundboxResult"]>("POST", "/api/v1/soundbox/text", { text, followup, speak }, {}, SLOW_MS),
  sourcing: (productId: string) => request<S["SourcingOut"]>("GET", `/api/v1/products/${productId}/sourcing`),
  buy: (quoteId: string, packs: number, sellPrice: string) =>
    request<S["TaskDetail"]>("POST", "/api/v1/purchases", { quote_id: quoteId, packs, sell_price: sellPrice }),
  profit: () => request<S["ProfitReport"]>("GET", "/api/v1/profit"),
  soundboxToday: () => request<S["SoundboxToday"]>("GET", "/api/v1/soundbox/today"),
  soundboxQr: () => request<S["SoundboxQr"]>("GET", "/api/v1/soundbox/qr"),
  soundboxUndo: (saleId: string) => request<S["CounterSaleOut"]>("POST", `/api/v1/soundbox/sales/${saleId}/undo`),
  soundboxPay: (amount: string, payer = "", saleId?: string) =>
    request<S["QrPaymentOut"]>("POST", "/api/v1/soundbox/qr-payments", { amount, payer, sale_id: saleId ?? null }),
  announcement: (eventId: number) => request<S["AudioOut"]>("GET", `/api/v1/soundbox/announcements/${eventId}`, undefined, {}, SLOW_MS),
  live: (after: number | null, wait = 20) =>
    request<S["LiveOut"]>("GET", `/api/v1/live?wait=${wait}${after == null ? "" : `&after=${after}`}`, undefined, {}, (wait + 10) * 1000),
  payInfo: (token: string, bill?: string | null) =>
    request<S["PayPageInfo"]>("GET", `/api/v1/pay/${token}${bill ? `?bill=${encodeURIComponent(bill)}` : ""}`),
  pay: (token: string, amount: string, payer: string, saleId?: string) =>
    request<S["QrPaymentOut"]>("POST", `/api/v1/pay/${token}`, { amount, payer, sale_id: saleId ?? null }),
};

/** "19 Oct" from an ISO date. */
export const day = (iso: string) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export const SOURCE_LABEL: Record<string, string> = {
  INVENTORY: "Inventory", KHATA: "Khata", PAYTM: "Paytm payments", PEERS: "Nearby stores", POS: "POS sales", SARVAM: "Sarvam voice", SUPPLIER: "Suppliers",
};

/** "PAYMENT_LINK_CREATED" -> "Payment link created". */
export const eventLabel = (type: string) => type.charAt(0) + type.slice(1).toLowerCase().replaceAll("_", " ");

/** "1 day", "3 days". */
export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export const rupees = (v: string | number | null | undefined, d = 0) => {
  if (v == null) return "—";
  const n = Number(v);
  return `${n < 0 ? "−" : ""}₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
