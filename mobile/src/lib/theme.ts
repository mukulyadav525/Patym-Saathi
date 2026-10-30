// Shared design tokens (mirrored in web/src/app/globals.css).
export const colors = {
  navy: "#002E6E",
  navyDeep: "#00205A",
  cyan: "#00B9F1",
  cyanSoft: "#E5F7FD",
  bg: "#F3F7FB",
  card: "#FFFFFF",
  ink: "#0B1B33",
  inkSoft: "#4A5B73",
  muted: "#8A98AC",
  line: "#E3EAF2",
  green: "#12A150",
  greenSoft: "#E6F6EC",
  amber: "#E08A00",
  amberSoft: "#FFF4E0",
  red: "#D93A3A",
  redSoft: "#FDECEC",
  violet: "#6B5CE7",
  violetSoft: "#EFEDFD",
};

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 };
export const space = (n: number) => n * 4;

export const shadow = {
  shadowColor: "#0B1B33",
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};

export type Tone = "navy" | "cyan" | "green" | "amber" | "red" | "violet" | "muted";

export const toneColors: Record<Tone, { fg: string; bg: string }> = {
  navy: { fg: colors.navy, bg: colors.cyanSoft },
  cyan: { fg: "#0083AD", bg: colors.cyanSoft },
  green: { fg: colors.green, bg: colors.greenSoft },
  amber: { fg: colors.amber, bg: colors.amberSoft },
  red: { fg: colors.red, bg: colors.redSoft },
  violet: { fg: colors.violet, bg: colors.violetSoft },
  muted: { fg: colors.inkSoft, bg: "#EEF2F7" },
};

const STATE_TONE: Record<string, Tone> = {
  AWAITING_APPROVAL: "amber",
  PENDING: "amber",
  DRAFTED: "amber",
  EXCEPTION: "red",
  FAILED: "red",
  RECONCILIATION_REQUIRED: "red",
  CANCELLED: "muted",
  REJECTED: "muted",
  SUPERSEDED: "muted",
  EXPIRED: "muted",
  COMPLETED: "green",
  PAID: "green",
  VERIFIED: "green",
  CONSUMED: "green",
  CONFIRMED: "green",
  SHARED: "green",
  DISCARDED: "muted",
  ACCEPTED: "green",
  GOODS_RECEIVED: "green",
  PARTIALLY_COMPLETED: "violet",
  PARTIALLY_ACCEPTED: "violet",
};

export const stateTone = (state: string): Tone => STATE_TONE[state] ?? "cyan";

const STATE_LABEL: Record<string, string> = {
  AWAITING_APPROVAL: "Needs approval",
  PLAN_DRAFTED: "Plan drafted",
  EVIDENCE_READY: "Evidence ready",
  VERIFYING: "Tracking",
  PARTIALLY_COMPLETED: "Partly done",
  PARTIALLY_ACCEPTED: "Partly accepted",
  GOODS_RECEIVED: "Received",
  RECONCILIATION_REQUIRED: "Check payment",
  CONSUMED: "Approved",
};

export const stateLabel = (state: string) =>
  STATE_LABEL[state] ?? state.charAt(0) + state.slice(1).toLowerCase().replace(/_/g, " ");
