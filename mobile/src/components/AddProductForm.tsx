import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { Button, Card, Row, Txt, styles as ui } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { rupees } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";

export type ProductDraft = { name: string; name_hi: string; pack_label: string; sell_price: string; stock: string; cost_price: string };

/** New item form, used by Inventory (counted stock) and by a supplier bill (packs arrive with the bill). */
export function AddProductForm({ initial, stockLabel = "Opening stock (packs)", submitLabel = "Add product", note, onSubmit, onCancel }: {
  initial?: Partial<ProductDraft>; stockLabel?: string; submitLabel?: string; note?: string;
  onSubmit: (d: ProductDraft) => Promise<void>; onCancel?: () => void;
}) {
  const [d, setD] = useState<ProductDraft>({ name: "", name_hi: "", pack_label: "1 pack", sell_price: "", stock: "0", cost_price: "", ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (v: string) => v.replace(/[^\d.]/g, "").slice(0, 9);
  const margin = d.sell_price && d.cost_price ? Number(d.sell_price) - Number(d.cost_price) : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(d);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, key: keyof ProductDraft, props: Partial<React.ComponentProps<typeof TextInput>> = {}, clean?: (v: string) => string) => (
    <View style={{ flex: 1, marginBottom: 12 }}>
      <Txt style={s.label}>{label}</Txt>
      <TextInput value={d[key]} onChangeText={(v) => setD({ ...d, [key]: clean ? clean(v) : v })} style={s.input}
        placeholderTextColor={colors.muted} accessibilityLabel={label} {...props} />
    </View>
  );

  return (
    <Card>
      {note && <Txt style={[ui.muted, { marginBottom: 12 }]}>{note}</Txt>}
      {field("Name", "name", { placeholder: "Parle-G Biscuit", maxLength: 60 })}
      {field("Name in Hindi (optional)", "name_hi", { placeholder: "पारले-जी बिस्कुट", maxLength: 60 })}
      {field("Pack size", "pack_label", { placeholder: "800 g, 1 kg, 12-pack", maxLength: 40 })}
      <Row style={{ gap: 10 }}>
        {field("Selling price ₹", "sell_price", { keyboardType: "decimal-pad", placeholder: "90" }, money)}
        {field("Cost price ₹ (optional)", "cost_price", { keyboardType: "decimal-pad", placeholder: "78" }, money)}
      </Row>
      {field(stockLabel, "stock", { keyboardType: "number-pad" }, (v) => v.replace(/\D/g, "").slice(0, 5))}
      {margin !== null && (
        <Txt style={{ fontSize: 12, fontWeight: "700", color: margin >= 0 ? colors.green : colors.red, marginBottom: 8 }}>
          {margin >= 0 ? `Profit ${rupees(margin)} per pack` : "Cost is above the selling price"}
        </Txt>
      )}
      {error && <Txt style={s.error}>{error}</Txt>}
      <Button label={submitLabel} icon="add-circle" loading={busy} disabled={d.name.trim().length < 2 || !d.sell_price} onPress={() => void submit()} />
      {onCancel && <Button label="Cancel" kind="ghost" onPress={onCancel} style={{ marginTop: 4 }} />}
    </Card>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "700", color: colors.inkSoft, marginBottom: 6 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 15, color: colors.ink, backgroundColor: "#FAFCFE" },
  error: { color: colors.red, backgroundColor: colors.redSoft, padding: 10, borderRadius: radius.sm, marginBottom: 10, fontSize: 13 },
});
