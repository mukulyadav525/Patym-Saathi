import { View } from "react-native";

import { Row, StateBadge, Txt, styles as ui } from "@/components/ui";
import type { TaskDetail } from "@/lib/api";
import { plural, rupees } from "@/lib/hooks";
import { colors } from "@/lib/theme";

/** Compact card body for a task (used in chat and inbox). */
export function PlanSummary({ task }: { task: TaskDetail }) {
  const plan = task.plans[task.plans.length - 1];
  if (task.task_type === "COLLECT_DUE" && task.invoice) {
    return (
      <View>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt style={ui.h3}>Payment link · {task.invoice.customer_name}</Txt>
          <StateBadge state={task.state} />
        </Row>
        <Txt style={[ui.money, { marginTop: 6 }]}>{rupees(task.invoice.amount)}</Txt>
        <Txt style={ui.muted}>
          {task.invoice.invoice_number} · {plural(task.invoice.days_overdue, "day")} overdue
        </Txt>
      </View>
    );
  }
  if (!plan) return <Txt>{task.title}</Txt>;
  return (
    <View>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt style={ui.h3}>Purchase plan v{plan.version}</Txt>
        <StateBadge state={task.state} />
      </Row>
      <Row style={{ alignItems: "flex-end", marginTop: 6 }}>
        <Txt style={ui.money}>{rupees(plan.total)}</Txt>
        <Txt style={[ui.muted, { marginLeft: 6, marginBottom: 5 }]}>of {rupees(plan.budget)} budget</Txt>
      </Row>
      <BudgetBar total={plan.total} budget={plan.budget} committed={plan.committed_total} />
      <Txt style={[ui.muted, { marginTop: 6 }]}>
        {plural(plan.lines.length, "line")} · {plural(plan.total_packs, "pack")} · {Array.from(new Set(plan.lines.map((l) => l.supplier_name))).join(" + ")}
      </Txt>
    </View>
  );
}

export function BudgetBar({ total, budget, committed = "0" }: { total: string; budget: string; committed?: string }) {
  const b = Number(budget);
  const pct = (v: string) => `${Math.min(100, (Number(v) / b) * 100)}%` as const;
  return (
    <View style={{ height: 8, backgroundColor: colors.line, borderRadius: 4, marginTop: 8, overflow: "hidden" }}>
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(total), backgroundColor: colors.cyan }} />
      {Number(committed) > 0 && (
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(committed), backgroundColor: colors.navy }} />
      )}
    </View>
  );
}
