import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";

import { AddProductForm } from "@/components/AddProductForm";
import { SourceNote } from "@/components/grow";
import { Badge, Button, Card, Row, Screen, SectionTitle, StateBadge, TopBar, Txt, styles as ui } from "@/components/ui";
import { api, ApiError, type Receipt, type S } from "@/lib/api";
import { plural, rupees, timeAgo, useLoad } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";

const SAMPLE = "Gupta Distributors\nAtta 10kg x 4 @ 380 = 1520\nCheeni 1kg 10 42 420\nToor dal 1kg 3 150 450\nTotal 2390";

type Line = { product_id: string; name: string; pack_label: string; packs: number; unit_price: string | null };

export default function BillsScreen() {
  const history = useLoad(api.bills);
  const [mode, setMode] = useState<"photo" | "text">("photo");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Receipt | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [newItems, setNewItems] = useState<S["NewBillItem"][]>([]);
  const [adding, setAdding] = useState<S["NewBillItem"] | null>(null);

  const load = (r: Receipt) => {
    setDraft(r);
    setNewItems(r.new_items ?? []);
    setAdding(null);
    setLines(r.lines.map((l) => ({ product_id: l.product_id, name: l.name, pack_label: l.pack_label, packs: l.packs, unit_price: l.unit_price })));
  };

  const fail = (title: string, e: unknown) => Alert.alert(title, e instanceof ApiError ? e.message : String(e));

  const pick = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow access, or type the bill lines instead.");
      setMode("text");
      return;
    }
    const res = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.7 });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const form = new FormData();
    const type = asset.mimeType ?? "image/jpeg";
    if (Platform.OS === "web") form.append("file", await (await fetch(asset.uri)).blob(), asset.fileName ?? "bill.jpg");
    else form.append("file", { uri: asset.uri, name: asset.fileName ?? "bill.jpg", type } as unknown as Blob);
    setBusy("photo");
    try {
      load(await api.billFromPhoto(form));
    } catch (e) {
      fail("Couldn't read the photo", e);
      setMode("text");
    } finally {
      setBusy(null);
    }
  };

  const readText = async () => {
    setBusy("text");
    try {
      load(await api.billFromText(text));
    } catch (e) {
      fail("Couldn't read the bill", e);
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    if (!draft) return;
    setBusy("confirm");
    try {
      const done = await api.confirmBill(draft.id, lines.map((l) => ({ product_id: l.product_id, packs: l.packs, unit_price: l.unit_price })),
        draft.supplier_name || undefined);
      Alert.alert("Stock updated", `+${plural(done.lines.reduce((s, l) => s + l.packs, 0), "pack")} added from this bill.`);
      setDraft(null);
      setText("");
      history.reload();
    } catch (e) {
      fail("Not confirmed", e);
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (!draft) return;
    await api.discardBill(draft.id).catch(() => undefined);
    setDraft(null);
    history.reload();
  };

  const setPacks = (i: number, packs: number) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, packs: Math.max(1, Math.min(1000, packs)) } : l)));
  const remove = (i: number) => setLines((ls) => ls.filter((_, j) => j !== i));
  const totalPacks = lines.reduce((s, l) => s + l.packs, 0);

  return (
    <Screen refreshing={history.refreshing} onRefresh={history.reload}>
      <TopBar title="Bill to stock" />
      {!draft ? (
        <>
          <Txt style={[ui.muted, { marginBottom: 12 }]}>Add a supplier bill. Saathi reads the items; you check every line. Stock changes only when you confirm.</Txt>
          <Row style={{ gap: 8, marginBottom: 12 }}>
            {(["photo", "text"] as const).map((m) => (
              <Pressable key={m} onPress={() => setMode(m)} style={[s.seg, mode === m && s.segOn]} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
                <Ionicons name={m === "photo" ? "camera-outline" : "create-outline"} size={16} color={mode === m ? "#fff" : colors.inkSoft} />
                <Txt style={[s.segText, mode === m && { color: "#fff" }]}>{m === "photo" ? "Photo" : "Type bill"}</Txt>
              </Pressable>
            ))}
          </Row>
          {mode === "photo" ? (
            <Card>
              <View style={s.drop}>
                <Ionicons name="receipt-outline" size={40} color={colors.navy} />
                <Txt style={[ui.h3, { marginTop: 8 }]}>Photo of the supplier bill</Txt>
                <Txt style={[ui.muted, { textAlign: "center", marginTop: 4 }]}>Read with Sarvam Vision. Needs the Sarvam key on the server; you can always type it instead.</Txt>
              </View>
              <Row style={{ gap: 10, marginTop: 12 }}>
                <Button label="Take photo" icon="camera" small style={{ flex: 1 }} loading={busy === "photo"} onPress={() => void pick(true)} />
                <Button label="From gallery" icon="images-outline" kind="secondary" small style={{ flex: 1 }} onPress={() => void pick(false)} />
              </Row>
            </Card>
          ) : (
            <Card>
              <TextInput value={text} onChangeText={setText} multiline style={s.textarea} placeholder={SAMPLE} placeholderTextColor={colors.muted}
                accessibilityLabel="Bill text" textAlignVertical="top" />
              <Row style={{ gap: 10 }}>
                <Button label="Use sample" kind="secondary" small style={{ flex: 1 }} onPress={() => setText(SAMPLE)} />
                <Button label="Read bill" icon="scan-outline" small style={{ flex: 1 }} loading={busy === "text"} disabled={text.trim().length < 3} onPress={() => void readText()} />
              </Row>
            </Card>
          )}
        </>
      ) : (
        <>
          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt style={ui.h3}>{draft.supplier_name || "Supplier bill"}</Txt>
              <Badge label={draft.source === "PHOTO" ? "From photo" : "Typed"} tone="cyan" />
            </Row>
            <Txt style={[ui.muted, { marginTop: 2 }]}>Check each line. Change packs or remove anything wrong.</Txt>
            {lines.length === 0 && <Txt style={[ui.muted, { marginTop: 12 }]}>No items recognised. Discard and type the lines.</Txt>}
            {lines.map((l, i) => (
              <Row key={`${l.product_id}-${i}`} style={s.line}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: "700" }}>{l.name}</Txt>
                  <Txt style={ui.muted}>{l.pack_label}{l.unit_price ? ` · ${rupees(l.unit_price)} each` : " · price not read"}</Txt>
                </View>
                <Row style={s.stepper}>
                  <Pressable onPress={() => setPacks(i, l.packs - 1)} style={s.stepBtn} accessibilityLabel={`Fewer ${l.name}`}><Ionicons name="remove" size={18} color={colors.navy} /></Pressable>
                  <Txt style={s.stepVal}>{l.packs}</Txt>
                  <Pressable onPress={() => setPacks(i, l.packs + 1)} style={s.stepBtn} accessibilityLabel={`More ${l.name}`}><Ionicons name="add" size={18} color={colors.navy} /></Pressable>
                </Row>
                <Pressable onPress={() => remove(i)} hitSlop={8} style={{ marginLeft: 8 }} accessibilityLabel={`Remove ${l.name}`}>
                  <Ionicons name="trash-outline" size={20} color={colors.red} />
                </Pressable>
              </Row>
            ))}
            {newItems.length > 0 && !adding && (
              <View style={s.unmatched}>
                <Txt style={{ fontWeight: "700", fontSize: 12, color: colors.amber }}>New on this bill: not in your inventory yet</Txt>
                {newItems.map((n) => (
                  <Row key={n.source_text} style={{ paddingVertical: 6 }}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Txt style={{ fontWeight: "700" }} numberOfLines={1}>{n.name || n.source_text}</Txt>
                      <Txt style={[ui.muted, { fontSize: 12 }]} numberOfLines={1}>
                        {n.pack_label} · {plural(n.packs, "pack")}{n.unit_price ? ` · ${rupees(n.unit_price)} each` : ""}
                      </Txt>
                    </View>
                    <Button label="Add" icon="add-circle-outline" small kind="secondary" onPress={() => setAdding(n)} />
                  </Row>
                ))}
              </View>
            )}
            {draft.bill_total && <SourceNote text={`Bill printed total ${rupees(draft.bill_total)} · lines read ${rupees(draft.total)}`} />}
          </Card>
          {adding && draft && (
            <AddProductForm submitLabel="Add item and put it on the bill" stockLabel="Packs on this bill"
              note="Set your selling price. Stock and cost price arrive when you confirm this bill."
              initial={{ name: adding.name, pack_label: adding.pack_label, cost_price: adding.unit_price ? String(Number(adding.unit_price)) : "",
                sell_price: adding.suggested_sell_price ? String(Number(adding.suggested_sell_price)) : "", stock: String(adding.packs) }}
              onCancel={() => setAdding(null)}
              onSubmit={async (d) => {
                const r = await api.billNewItem(draft.id, { name: d.name.trim(), name_hi: d.name_hi.trim() || null,
                  pack_label: d.pack_label.trim() || "1 pack", sell_price: d.sell_price, packs: Math.max(1, Number(d.stock || 1)),
                  unit_price: d.cost_price || null });
                const line = r.lines[r.lines.length - 1];
                setLines((cur) => [...cur, { product_id: line.product_id, name: line.name, pack_label: line.pack_label, packs: line.packs, unit_price: line.unit_price }]);
                setNewItems((cur) => cur.filter((x) => x.source_text !== adding.source_text));
                setDraft(r);
                setAdding(null);
              }} />
          )}
          <Button label={`Add ${plural(totalPacks, "pack")} to stock`} icon="checkmark-circle" loading={busy === "confirm"} disabled={lines.length === 0} onPress={() => void confirm()} />
          <Button label="Discard" kind="ghost" onPress={() => void discard()} style={{ marginTop: 4 }} />
        </>
      )}

      {(history.data ?? []).length > 0 && (
        <>
          <SectionTitle title="Recent bills" />
          <Card>
            {(history.data ?? []).map((r, i) => (
              <Row key={r.id} style={[{ paddingVertical: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: "700" }}>{r.supplier_name || "Supplier bill"}</Txt>
                  <Txt style={ui.muted}>{plural(r.lines.reduce((s2, l) => s2 + l.packs, 0), "pack")} · {timeAgo(r.created_at)}</Txt>
                </View>
                {r.status === "DRAFT" ? (
                  <Pressable onPress={() => load(r)} hitSlop={8}><Txt style={{ color: "#0083AD", fontWeight: "700" }}>Review</Txt></Pressable>
                ) : <StateBadge state={r.status} />}
              </Row>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  seg: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff" },
  segOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  segText: { fontWeight: "700", color: colors.inkSoft },
  drop: { alignItems: "center", padding: 18, borderRadius: radius.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#BFE9FA", backgroundColor: "#F2FBFF" },
  textarea: { minHeight: 140, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.ink, backgroundColor: "#FAFCFE", marginBottom: 12 },
  line: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F1F4F8" },
  stepper: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill },
  stepBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  stepVal: { minWidth: 28, textAlign: "center", fontWeight: "800" },
  unmatched: { marginTop: 10, padding: 10, borderRadius: radius.sm, backgroundColor: colors.amberSoft },
});
