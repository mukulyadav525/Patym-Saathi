import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, Share, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BudgetBar } from "@/components/PlanSummary";
import { Timeline } from "@/components/Timeline";
import {
  Badge, Button, Card, Divider, ErrorState, IconTile, Loading, Row, Screen, SectionTitle, SimBadge, StateBadge, TopBar, Txt,
  styles as ui,
} from "@/components/ui";
import { api, ApiError, type TaskDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { rupees, timeAgo, useLoad } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";
import { playBase64, stopPlayback } from "@/lib/voice";

export default function TaskScreen() {
  const { id, review } = useLocalSearchParams<{ id: string; review?: string }>();
  const { session } = useAuth();
  const { data: task, setData, error, loading, refreshing, reload } = useLoad(() => api.task(id), [id]);
  const [sheet, setSheet] = useState(false);
  const reviewed = useRef(false);

  // "Approve" on a task card lands here with review=1: open the review sheet once the task is loaded.
  useEffect(() => {
    if (review === "1" && !reviewed.current && task?.pending_approval_id) {
      reviewed.current = true;
      setSheet(true);
    }
  }, [review, task?.pending_approval_id]);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<TaskDetail | void>) => {
    setBusy(label);
    try {
      const res = await fn();
      if (res) setData(res);
      else await reload();
    } catch (e) {
      Alert.alert("Couldn't complete", e instanceof ApiError ? e.message : String(e));
      await reload();
    } finally {
      setBusy(null);
    }
  };

  if (loading && !task) return <Screen><TopBar title="Task" /><Loading /></Screen>;
  if (!task) return <Screen><TopBar title="Task" />{error && <ErrorState error={error} onRetry={reload} />}</Screen>;

  const plan = task.plans[task.plans.length - 1];
  const pending = task.approvals.find((a) => a.id === task.pending_approval_id);
  const openOrders = task.orders.filter((o) => o.status === "ACCEPTED" || o.status === "PARTIALLY_ACCEPTED");
  const demo = session?.demo_mode && session.user.role === "DEMO_ADMIN";

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Screen refreshing={refreshing} onRefresh={reload}>
        <TopBar title={task.task_type === "RESTOCK" ? "Purchase plan" : "Collect dues"} />
        <Card>
          <Row style={{ justifyContent: "space-between" }}>
            <StateBadge state={task.state} />
            <Txt style={ui.muted}>{timeAgo(task.created_at)}</Txt>
          </Row>
          <Txt style={[ui.h2, { marginTop: 8 }]}>{task.title}</Txt>
          <Row style={{ marginTop: 6 }}>
            <Ionicons name={task.input_channel === "VOICE" ? "mic-outline" : "chatbubble-ellipses-outline"} size={14} color={colors.muted} />
            <Txt style={[ui.muted, { marginLeft: 6, flex: 1, fontStyle: "italic" }]}>“{task.input_text}”</Txt>
          </Row>
          {task.result_note && (
            <View style={[s.note, task.state === "COMPLETED" && { backgroundColor: colors.greenSoft }]}>
              <Txt style={{ fontWeight: "600", color: task.state === "COMPLETED" ? colors.green : colors.inkSoft }}>{task.result_note}</Txt>
            </View>
          )}
          {task.time_to_plan_seconds != null && (
            <Txt style={[ui.muted, { marginTop: 8, fontSize: 11 }]}>Plan ready {task.time_to_plan_seconds.toFixed(1)}s after the request</Txt>
          )}
        </Card>

        {task.task_type === "RESTOCK" && plan && <PlanBlock task={task} awaiting={!!pending} />}
        {task.task_type === "COLLECT_DUE" && task.invoice && <DuesBlock task={task} onChanged={reload} />}

        {task.orders.length > 0 && (
          <>
            <SectionTitle title="Supplier orders" />
            {task.orders.map((o) => (
              <Card key={o.id}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Txt style={ui.h3}>{o.supplier_name}</Txt>
                  <StateBadge state={o.status} />
                </Row>
                <Row style={{ gap: 6, marginTop: 6 }}>
                  <Txt style={ui.muted}>{o.reference}</Txt>
                  <SimBadge />
                </Row>
                <Divider />
                {o.lines.map((l) => (
                  <Row key={l.product_id} style={{ paddingVertical: 3 }}>
                    <Txt style={[{ flex: 1 }, l.line_status === "UNAVAILABLE" && s.struck]}>
                      {l.name} × {l.packs}
                    </Txt>
                    {l.line_status === "UNAVAILABLE" ? <Badge label="Out of stock" tone="red" /> : <Txt style={{ fontWeight: "600" }}>{rupees(l.line_total)}</Txt>}
                  </Row>
                ))}
                <Divider />
                <Row style={{ justifyContent: "space-between" }}>
                  <Txt style={{ fontWeight: "700" }}>Accepted total</Txt>
                  <Txt style={{ fontWeight: "800" }}>{rupees(o.total)}</Txt>
                </Row>
              </Card>
            ))}
            {demo && openOrders.length > 0 && !pending && (
              <Card style={s.demoCard}>
                <Row style={{ marginBottom: 8 }}>
                  <SimBadge label="DEMO CONTROL" />
                </Row>
                <Txt style={ui.muted}>Orders are placed, not delivered. Record the simulated delivery to update inventory.</Txt>
                <Button label="Simulate delivery (goods received)" icon="cube" kind="secondary" style={{ marginTop: 10 }}
                  loading={busy === "delivery"} onPress={() => run("delivery", () => api.demoDelivery(task.id))} />
              </Card>
            )}
          </>
        )}

        {task.approvals.length > 0 && (
          <>
            <SectionTitle title="Approvals" />
            <Card>
              {task.approvals.map((a, i) => (
                <View key={a.id}>
                  {i > 0 && <Divider />}
                  <Row>
                    <IconTile icon={a.status === "CONSUMED" ? "checkmark-done" : a.status === "PENDING" ? "time-outline" : "close"} tone={a.status === "CONSUMED" ? "green" : a.status === "PENDING" ? "amber" : "muted"} size={34} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Txt style={{ fontWeight: "700" }}>{rupees(a.amount, 0)} · {a.summary}</Txt>
                      <Txt style={ui.muted}>
                        {a.status === "CONSUMED" && a.approved_at ? `Approved by you ${timeAgo(a.approved_at)}` : a.status === "PENDING" ? "Waiting for you" : a.status.toLowerCase()} · #{a.payload_hash_short}
                      </Txt>
                    </View>
                    <StateBadge state={a.status} />
                  </Row>
                </View>
              ))}
            </Card>
          </>
        )}

        <SectionTitle title="Activity" />
        <Card><Timeline events={task.events} /></Card>
      </Screen>

      {pending && (
        <SafeAreaView edges={["bottom"]} style={s.bar}>
          <View style={{ flex: 1 }}>
            <Txt style={ui.muted}>Approve to {pending.action_type === "SUPPLIER_ORDER" ? "place order" : "send link"}</Txt>
            <Txt style={{ fontSize: 22, fontWeight: "800" }}>{rupees(pending.amount)}</Txt>
          </View>
          <Button label="Reject" kind="danger" small loading={busy === "reject"} onPress={() => run("reject", () => api.reject(pending.id))} style={{ marginRight: 8 }} />
          <Button label="Review & approve" small icon="shield-checkmark" onPress={() => setSheet(true)} />
        </SafeAreaView>
      )}
      {pending && (
        <ApproveSheet
          visible={sheet}
          task={task}
          onClose={() => setSheet(false)}
          onDone={(t) => {
            setSheet(false);
            setData(t);
          }}
          onRenewed={setData}
        />
      )}
    </View>
  );
}

function PlanBlock({ task, awaiting }: { task: TaskDetail; awaiting: boolean }) {
  const plan = task.plans[task.plans.length - 1];
  const [showEvidence, setShowEvidence] = useState(false);
  return (
    <>
      {plan.diff.length > 0 && (
        <Card style={s.changed}>
          <Row style={{ marginBottom: 6 }}>
            <Ionicons name="swap-horizontal" size={18} color={colors.amber} />
            <Txt style={{ fontWeight: "800", marginLeft: 6, color: colors.amber }}>{awaiting ? "Plan changed — needs approval again" : "Plan changed after a supplier shortage"}</Txt>
          </Row>
          {plan.diff.map((d) => (
            <Txt key={d.name} style={{ marginTop: 2 }}>
              {d.name} × {d.packs}: {d.from_supplier ?? "—"} {d.from_unit_price ? rupees(d.from_unit_price) : ""} is out of stock → {d.to_supplier} {rupees(d.to_unit_price)}
              <Txt style={{ fontWeight: "800", color: colors.red }}> (+{rupees(d.delta)})</Txt>
            </Txt>
          ))}
        </Card>
      )}
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt style={ui.h3}>Plan v{plan.version}</Txt>
          <Badge label={plan.status} tone={plan.status === "ACTIVE" ? "cyan" : "muted"} />
        </Row>
        <Row style={{ alignItems: "flex-end", marginTop: 6 }}>
          <Txt style={ui.money}>{rupees(plan.total)}</Txt>
          <Txt style={[ui.muted, { marginLeft: 6, marginBottom: 5 }]}>
            of {rupees(plan.budget)} · {rupees(plan.remaining_budget)} left
          </Txt>
        </Row>
        <BudgetBar total={plan.total} budget={plan.budget} committed={plan.committed_total} />
        {plan.festival && (
          <View style={s.festival}>
            <Ionicons name="flame" size={14} color={colors.amber} />
            <Txt style={{ flex: 1, marginLeft: 6, fontSize: 12, color: colors.inkSoft }}>
              {plan.festival} plan: each item’s weekly demand is multiplied by how much more it sold in your last {plan.festival} week.
            </Txt>
          </View>
        )}
        <Row style={{ marginTop: 14, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <Txt style={[s.th, { flex: 1 }]}>Item</Txt>
          <Txt style={[s.th, s.num]}>Sold/wk</Txt>
          <Txt style={[s.th, s.num]}>Stock</Txt>
          <Txt style={[s.th, s.num]}>Order</Txt>
          <Txt style={[s.th, { width: 64, textAlign: "right" }]}>Total</Txt>
        </Row>
        {plan.lines.map((l) => (
          <View key={`${l.product_id}-${l.supplier_name}`} style={s.tr}>
            <Row>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: "700" }}>{l.name}</Txt>
                <Txt style={[ui.muted, { fontSize: 11 }]}>
                  {l.pack_label} · {rupees(l.unit_price)} · {l.supplier_name.split(" ")[0]}
                </Txt>
                {l.uplift && Number(l.uplift) > 1 && (
                  <Txt style={{ fontSize: 11, fontWeight: "800", color: colors.amber }}>{plan.festival} ×{Number(l.uplift).toFixed(1)}</Txt>
                )}
              </View>
              <Txt style={[s.num, s.td]}>{l.status === "COMMITTED" ? "–" : Number(l.sold_per_week).toFixed(0)}</Txt>
              <Txt style={[s.num, s.td]}>{l.status === "COMMITTED" ? "–" : l.stock}</Txt>
              <Txt style={[s.num, s.td, { fontWeight: "800" }]}>{l.packs}</Txt>
              <Txt style={[s.td, { width: 64, textAlign: "right", fontWeight: "700" }]}>{rupees(l.line_total)}</Txt>
            </Row>
            {l.status === "COMMITTED" && <Badge label="Already ordered" tone="navy" icon="checkmark" />}
          </View>
        ))}
        <Row style={{ justifyContent: "space-between", marginTop: 10 }}>
          <Txt style={{ fontWeight: "800" }}>{plan.total_packs} packs</Txt>
          <Txt style={{ fontWeight: "800", fontSize: 17 }}>{rupees(plan.total)}</Txt>
        </Row>
        <Pressable onPress={() => setShowEvidence(!showEvidence)} style={{ marginTop: 12 }}>
          <Row>
            <Ionicons name="document-text-outline" size={16} color="#0083AD" />
            <Txt style={[ui.link, { marginLeft: 6 }]}>{showEvidence ? "Hide" : "Show"} evidence & assumptions</Txt>
          </Row>
        </Pressable>
        {showEvidence && (
          <View style={s.evidence}>
            {plan.sources.map((x) => <Txt key={x} style={s.evLine}>• {x}</Txt>)}
            {plan.assumptions.map((x) => <Txt key={x} style={[s.evLine, { color: colors.inkSoft }]}>• {x}</Txt>)}
            {plan.missing.map((x) => <Txt key={x} style={[s.evLine, { color: colors.red }]}>• Missing: {x}</Txt>)}
            <Txt style={[s.evLine, { color: colors.muted }]}>Order = demand until next restock (7 days, 4-week average) − current stock, rounded to pack size.</Txt>
          </View>
        )}
      </Card>
      {task.plans.length > 1 && (
        <Txt style={[ui.muted, { marginBottom: 8, marginLeft: 4 }]}>
          Earlier: {task.plans.slice(0, -1).map((p) => `v${p.version} ${rupees(p.total)} (${p.status.toLowerCase()})`).join(" · ")}
        </Txt>
      )}
    </>
  );
}

function DuesBlock({ task, onChanged }: { task: TaskDetail; onChanged: () => Promise<void> }) {
  const inv = task.invoice!;
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const checks = [...task.events].reverse().find((e) => e.event_type === "STATUS_CHECKED")?.details?.checks as
    | Record<string, boolean>
    | undefined;
  const demo = session?.demo_mode && session.user.role === "DEMO_ADMIN";

  const act = async (fn: () => Promise<{ message: string }>) => {
    setBusy(true);
    try {
      setResult((await fn()).message);
    } catch (e) {
      setResult(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
      await onChanged();
    }
  };

  return (
    <>
      <Card>
        <Row>
          <IconTile icon="person-outline" tone="cyan" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Txt style={ui.h3}>{inv.customer_name}</Txt>
            <Txt style={ui.muted}>{inv.invoice_number} · {inv.customer_phone_masked}</Txt>
          </View>
          <StateBadge state={inv.status} />
        </Row>
        <Txt style={[ui.money, { marginTop: 10 }]}>{rupees(inv.amount)}</Txt>
        <Txt style={[ui.muted, inv.days_overdue > 0 && { color: colors.red, fontWeight: "600" }]}>
          {inv.status === "PAID" ? "Paid" : inv.days_overdue > 0 ? `${inv.days_overdue} days overdue` : `Due ${inv.due_date}`}
        </Txt>
        {inv.draft_message && (
          <View style={s.msg}>
            <Txt style={[ui.muted, { marginBottom: 4 }]}>Message to customer</Txt>
            <Txt>{inv.draft_message}</Txt>
          </View>
        )}
        {inv.link_url && (
          <View style={{ marginTop: 12 }}>
            <Row style={{ gap: 6, marginBottom: 6 }}>
              <Txt style={{ fontWeight: "700" }}>Payment link</Txt>
              <SimBadge label={inv.link_mode ?? "DEMO"} />
            </Row>
            <Txt style={[ui.muted, { fontSize: 12 }]} numberOfLines={1}>{inv.link_url}</Txt>
            <Row style={{ gap: 8, marginTop: 10 }}>
              <Button small kind="secondary" icon="share-social-outline" label="Share" style={{ flex: 1 }}
                onPress={() => Share.share({ message: `${inv.draft_message}\n${inv.link_url}` })} />
              <Button small kind="secondary" icon="copy-outline" label="Copy" style={{ flex: 1 }}
                onPress={() => Clipboard.setStringAsync(inv.link_url!)} />
            </Row>
            <Txt style={[ui.muted, { fontSize: 11, marginTop: 6 }]}>
              {inv.link_mode === "DEMO" ? "DEMO link: no real money moves. " : ""}You share it; Saathi doesn’t send messages.
            </Txt>
          </View>
        )}
      </Card>

      {(inv.status === "SENT" || inv.status === "RECONCILIATION_REQUIRED") && (
        <Card>
          <Txt style={ui.h3}>{inv.status === "SENT" ? "Waiting for the customer" : "Payment needs checking"}</Txt>
          <Txt style={[ui.muted, { marginTop: 2 }]}>
            {inv.status === "SENT"
              ? "Saathi marks it paid only after Paytm confirms it. Customer says they paid? Check again."
              : "The payment did not match this invoice. Check again, or mark it not received to collect it again."}
          </Txt>
          <Row style={{ gap: 8, marginTop: 10 }}>
            <Button small kind="secondary" icon="refresh" label="Check again" style={{ flex: 1 }} loading={busy}
              onPress={() => void act(() => api.recheckPayment(inv.id))} />
            {inv.status === "SENT" ? (
              <Button small kind="danger" icon="close-circle-outline" label="Withdraw link" style={{ flex: 1 }}
                onPress={() => Alert.alert("Withdraw this link?", "Use it when the customer won’t pay with this link. You can create a new one after.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Withdraw", style: "destructive", onPress: () => void act(() => api.withdrawLink(inv.id)) },
                ])} />
            ) : (
              <Button small kind="danger" icon="close-circle-outline" label="Not received" style={{ flex: 1 }}
                onPress={() => Alert.alert("Mark as not received?", "The invoice becomes collectable again. Nothing is sent to the customer.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Not received", style: "destructive", onPress: () => void act(() => api.notReceived(inv.id)) },
                ])} />
            )}
          </Row>
          {result && <Txt style={[ui.muted, { marginTop: 8, color: colors.inkSoft }]}>{result}</Txt>}
        </Card>
      )}

      {(inv.status === "PAID" || inv.status === "RECONCILIATION_REQUIRED") && checks && (
        <Card style={{ backgroundColor: inv.status === "PAID" ? colors.greenSoft : colors.redSoft }}>
          <Txt style={[ui.h3, { color: inv.status === "PAID" ? colors.green : colors.red }]}>
            {inv.status === "PAID" ? "Payment verified" : "Payment did not match — not marked paid"}
          </Txt>
          <Txt style={[ui.muted, { marginBottom: 6 }]}>Signed webhook + server-side status check</Txt>
          {Object.entries({ mid: "Merchant ID", order_id: "Order ID", amount: "Amount", status: "Status = success" }).map(([k, label]) => (
            <Row key={k} style={{ paddingVertical: 2 }}>
              <Ionicons name={checks[k] ? "checkmark-circle" : "close-circle"} size={18} color={checks[k] ? colors.green : colors.red} />
              <Txt style={{ marginLeft: 8 }}>{label}</Txt>
            </Row>
          ))}
        </Card>
      )}

      {demo && inv.status === "SENT" && (
        <Card style={s.demoCard}>
          <Row style={{ marginBottom: 8 }}><SimBadge label="DEMO CONTROL" /></Row>
          <Txt style={ui.muted}>Pretend the customer paid by UPI. This sends a signed DEMO webhook through the real verification path.</Txt>
          <Button label="Simulate customer UPI payment" icon="phone-portrait-outline" kind="secondary" style={{ marginTop: 10 }} loading={busy}
            onPress={async () => {
              setBusy(true);
              try {
                const r = await api.demoPayment(inv.id);
                setResult(r.message);
              } catch (e) {
                setResult(e instanceof ApiError ? e.message : String(e));
              } finally {
                setBusy(false);
                await onChanged();
              }
            }} />
          {result && <Txt style={[ui.muted, { marginTop: 8, color: colors.inkSoft }]}>{result}</Txt>}
        </Card>
      )}
    </>
  );
}

function ApproveSheet({ visible, task, onClose, onDone, onRenewed }: {
  visible: boolean; task: TaskDetail; onClose: () => void; onDone: (t: TaskDetail) => void; onRenewed: (t: TaskDetail) => void;
}) {
  const { session } = useAuth();
  const needsPin = !!session?.user.has_approval_pin;
  const [pin, setPin] = useState("");
  const pending = task.approvals.find((a) => a.id === task.pending_approval_id)!;
  const plan = task.plans[task.plans.length - 1];
  const key = useRef(api.newKey());
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const [heard, setHeard] = useState<{ text: string; voice: string } | null>(null);
  useEffect(() => () => stopPlayback(), []);
  const [listening, setListening] = useState(false);

  // Read-back is built on the server from the stored plan/invoice; audio only when Sarvam is configured.
  const listen = async () => {
    setListening(true);
    try {
      const rb = await api.readback(task.id, "hi-IN", true);
      setHeard({ text: rb.text, voice: rb.voice });
      if (rb.audio_base64) await playBase64(rb.audio_base64, rb.mime ?? "audio/wav");
    } catch (e) {
      setHeard({ text: e instanceof ApiError ? e.message : "Read-back unavailable", voice: "OFF" });
    } finally {
      setListening(false);
    }
  };

  useEffect(() => {
    key.current = api.newKey(); // fresh key per approval, reused across retries of this one
  }, [pending.id]);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(pending.expires_at).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pending.expires_at]);

  // Expired window: ask the server for a fresh one; it re-checks the plan is unchanged first.
  const renew = async () => {
    setBusy(true);
    try {
      onRenewed(await api.renewApproval(task.id));
    } catch (e) {
      Alert.alert("Couldn't renew", e instanceof ApiError ? e.message : String(e));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      onDone(await api.confirm(pending.id, key.current, needsPin ? pin : undefined));
    } catch (e) {
      // A wrong PIN keeps the sheet open so the merchant can retry; anything else closes it.
      if (e instanceof ApiError && (e.code === "PIN_INVALID" || e.code === "PIN_REQUIRED")) {
        setPin("");
        Alert.alert("Wrong PIN", e.message);
        return;
      }
      if (e instanceof ApiError && e.code === "QUOTE_CHANGED") {
        // Supplier prices moved since the plan was made: fetch a fresh plan and let the merchant review it.
        try {
          onRenewed(await api.renewApproval(task.id));
          Alert.alert("Prices changed", "Supplier prices changed since this plan was made. Review the updated plan, then approve.");
        } catch (e2) {
          Alert.alert("Not approved", e2 instanceof ApiError ? e2.message : String(e2));
        }
        onClose();
        return;
      }
      Alert.alert("Not approved", e instanceof ApiError ? e.message : String(e));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const suppliers = plan ? Array.from(new Set(plan.lines.filter((l) => l.status === "NEW").map((l) => l.supplier_name))) : [];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalRoot}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView edges={["bottom"]} style={s.sheet}>
        <View style={s.grab} />
        <Txt style={ui.h2}>Confirm approval</Txt>
        <Txt style={[ui.muted, { marginTop: 4 }]}>Read it once. Saathi acts only on exactly this.</Txt>
        <View style={s.readback}>
          {pending.action_type === "SUPPLIER_ORDER" && plan ? (
            <>
              <Row style={{ justifyContent: "space-between" }}>
                <Txt style={{ fontWeight: "700" }}>{plan.version > 1 ? "Revised total" : "Total"}</Txt>
                <Txt style={{ fontWeight: "800" }}>{rupees(plan.total)}</Txt>
              </Row>
              {Number(plan.committed_total) > 0 && (
                <Row style={{ justifyContent: "space-between", marginTop: 4 }}>
                  <Txt style={ui.muted}>Already ordered</Txt>
                  <Txt style={ui.muted}>{rupees(plan.committed_total)}</Txt>
                </Row>
              )}
              <Row style={{ justifyContent: "space-between", marginTop: 4 }}>
                <Txt style={ui.muted}>New order now</Txt>
                <Txt style={{ fontWeight: "700" }}>{rupees(Number(plan.total) - Number(plan.committed_total))} · {suppliers.join(" + ")}</Txt>
              </Row>
              <Row style={{ justifyContent: "space-between", marginTop: 4 }}>
                <Txt style={ui.muted}>Budget</Txt>
                <Txt style={ui.muted}>{rupees(plan.budget)}</Txt>
              </Row>
            </>
          ) : (
            <Row style={{ justifyContent: "space-between" }}>
              <Txt style={{ fontWeight: "700" }}>Payment link to {task.invoice?.customer_name}</Txt>
              <Txt style={{ fontWeight: "800" }}>{rupees(pending.amount)}</Txt>
            </Row>
          )}
        </View>
        <Row style={{ gap: 6, marginBottom: 10 }}>
          <SimBadge label={pending.action_type === "SUPPLIER_ORDER" ? "SIMULATED SUPPLIER" : "DEMO PAYMENT LINK"} />
          <Badge label={left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Expired"} tone={left > 60 ? "muted" : "red"} icon="time-outline" />
        </Row>
        <Pressable onPress={listen} style={s.listen} accessibilityRole="button" accessibilityLabel="Read back what you are approving">
          <Ionicons name={listening ? "hourglass-outline" : "volume-medium-outline"} size={18} color={colors.navy} />
          <Txt style={{ marginLeft: 6, fontWeight: "700", color: colors.navy }}>Suno · Read back</Txt>
        </Pressable>
        {heard && (
          <View style={s.heard}>
            <Txt style={{ fontSize: 13, color: colors.inkSoft }}>{heard.text}</Txt>
            {heard.voice === "OFF" && <Txt style={[ui.muted, { fontSize: 11, marginTop: 4 }]}>Audio off (no Sarvam key) · text read-back</Txt>}
          </View>
        )}
        {needsPin && (
          <TextInput
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, "").slice(0, 4))}
            placeholder="Approval PIN"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            style={[s.pin, pin.length > 0 && { letterSpacing: 6 }]}
            placeholderTextColor={colors.muted}
            accessibilityLabel="Approval PIN"
          />
        )}
        {left === 0 ? (
          <Button label="Approval window expired · Renew" icon="refresh" onPress={renew} loading={busy} />
        ) : (
          <Button label={`Approve ${rupees(pending.amount)}`} icon="checkmark-circle" onPress={approve} loading={busy}
            disabled={needsPin && pin.length !== 4} />
        )}
        <Button label="Cancel" kind="ghost" onPress={onClose} style={{ marginTop: 4 }} />
        <Txt style={[ui.muted, { textAlign: "center", fontSize: 11 }]}>Voice “haan” never approves. Only this tap does.</Txt>
      </SafeAreaView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  note: { marginTop: 10, padding: 10, borderRadius: radius.sm, backgroundColor: colors.cyanSoft },
  changed: { backgroundColor: colors.amberSoft, borderWidth: 1, borderColor: "#FFD48A" },
  th: { fontSize: 11, color: colors.muted, fontWeight: "700" },
  td: { fontSize: 14 },
  num: { width: 46, textAlign: "center" },
  tr: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F1F4F8", gap: 4 },
  evidence: { marginTop: 8, padding: 10, backgroundColor: colors.bg, borderRadius: radius.sm },
  evLine: { fontSize: 12, marginBottom: 3 },
  struck: { textDecorationLine: "line-through", color: colors.muted },
  demoCard: { borderWidth: 1, borderStyle: "dashed", borderColor: colors.violet, backgroundColor: "#FBFAFF" },
  msg: { marginTop: 12, padding: 12, backgroundColor: colors.bg, borderRadius: radius.md },
  bar: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: colors.line },
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(11,27,51,0.45)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, alignSelf: "center", marginBottom: 14 },
  readback: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 14, marginVertical: 14 },
  pin: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, marginBottom: 12, color: colors.ink },
  festival: { flexDirection: "row", alignItems: "flex-start", marginTop: 10, padding: 10, borderRadius: radius.sm, backgroundColor: colors.amberSoft },
  listen: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", minHeight: 44, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.cyanSoft, marginBottom: 10 },
  heard: { padding: 10, borderRadius: radius.sm, backgroundColor: colors.bg, marginBottom: 12 },
});
