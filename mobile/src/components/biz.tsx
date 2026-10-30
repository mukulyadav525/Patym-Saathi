import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Txt, type IconName } from "@/components/ui";
import type { Lang } from "@/lib/prefs";
import { colors } from "@/lib/theme";

// Text wordmark only: this is a hackathon concept, so no Paytm logo artwork is bundled.
export function BizLogo() {
  return (
    <View style={{ alignItems: "center" }}>
      <Text style={{ fontSize: 26, fontWeight: "900", color: colors.navy, letterSpacing: -0.8, lineHeight: 28 }}>
        Pay<Text style={{ color: colors.cyan }}>tm</Text>
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <View style={s.rule} />
        <Text style={{ fontSize: 8, color: colors.navy, fontWeight: "700" }}>for</Text>
        <View style={s.rule} />
      </View>
      <Text style={{ fontSize: 15, fontWeight: "800", color: colors.navy, letterSpacing: 0.2, lineHeight: 17 }}>Business</Text>
    </View>
  );
}

export type ProductId = "qr" | "soundbox" | "card" | "loan";

const PRODUCT_ICON: Record<ProductId, IconName | "rupee"> = {
  qr: "qr-code-outline",
  soundbox: "volume-high-outline",
  card: "card-outline",
  loan: "rupee",
};

export function ProductIcon({ id, size = 48 }: { id: ProductId; size?: number }) {
  const icon = PRODUCT_ICON[id];
  if (icon === "rupee")
    return (
      <View style={{ width: size, height: size, borderRadius: size * 0.22, backgroundColor: colors.cyan, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: size * 0.72, height: size * 0.72, borderRadius: size, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontSize: size * 0.4, fontWeight: "800" }}>₹</Text>
        </View>
      </View>
    );
  return <Ionicons name={icon} size={size} color={colors.navy} />;
}

type Feature = { icon: IconName; color: string; label: Record<Lang, string> };
export type Product = {
  title: Record<Lang, string>;
  heroLine: Record<Lang, string>;
  heroBold: string;
  features: Feature[];
};

export const PRODUCTS: Record<ProductId, Product> = {
  qr: {
    title: { en: "All-in-One QR", hi: "ऑल-इन-वन QR" },
    heroLine: { en: "Accept every UPI app with one", hi: "हर UPI ऐप से पेमेंट, एक ही" },
    heroBold: "Paytm QR",
    features: [
      { icon: "apps-outline", color: colors.navy, label: { en: "All UPI apps accepted", hi: "सभी UPI ऐप स्वीकार" } },
      { icon: "flash-outline", color: colors.green, label: { en: "Instant settlement", hi: "तुरंत सेटलमेंट" } },
      { icon: "pricetag-outline", color: colors.amber, label: { en: "Zero MDR on UPI", hi: "UPI पर ज़ीरो MDR" } },
      { icon: "print-outline", color: colors.cyan, label: { en: "Free printed standee", hi: "फ्री प्रिंटेड स्टैंडी" } },
    ],
  },
  soundbox: {
    title: { en: "Soundbox", hi: "साउंडबॉक्स" },
    heroLine: { en: "Never miss a payment with", hi: "कोई पेमेंट न छूटे," },
    heroBold: "Paytm Soundbox",
    features: [
      { icon: "checkmark-circle", color: colors.green, label: { en: "Instant Payment Confirmation", hi: "तुरंत पेमेंट कन्फ़र्मेशन" } },
      { icon: "language-outline", color: colors.navy, label: { en: "11 Languages Supported", hi: "11 भाषाओं में" } },
      { icon: "cellular-outline", color: colors.navy, label: { en: "4G + Hotspot Connectivity", hi: "4G + हॉटस्पॉट कनेक्टिविटी" } },
      { icon: "battery-charging-outline", color: colors.green, label: { en: "7 Days Battery Life", hi: "7 दिन की बैटरी" } },
    ],
  },
  card: {
    title: { en: "Card Machine", hi: "कार्ड मशीन" },
    heroLine: { en: "Accept cards, UPI and wallets on", hi: "कार्ड, UPI और वॉलेट, एक ही" },
    heroBold: "Paytm Card Machine",
    features: [
      { icon: "card-outline", color: colors.navy, label: { en: "Debit & credit cards", hi: "डेबिट और क्रेडिट कार्ड" } },
      { icon: "wifi-outline", color: colors.cyan, label: { en: "Tap to pay (NFC)", hi: "टैप करके पेमेंट (NFC)" } },
      { icon: "receipt-outline", color: colors.amber, label: { en: "Printed receipts", hi: "प्रिंटेड रसीद" } },
      { icon: "volume-high-outline", color: colors.green, label: { en: "Built-in Soundbox", hi: "इनबिल्ट साउंडबॉक्स" } },
    ],
  },
  loan: {
    title: { en: "Merchant Loan", hi: "मर्चेंट लोन" },
    heroLine: { en: "Grow your shop with a", hi: "दुकान बढ़ाएं," },
    heroBold: "Merchant Loan",
    features: [
      { icon: "document-text-outline", color: colors.navy, label: { en: "Paperless process", hi: "बिना कागज़ी प्रक्रिया" } },
      { icon: "calendar-outline", color: colors.cyan, label: { en: "Daily repayment from sales", hi: "बिक्री से रोज़ाना भुगतान" } },
      { icon: "time-outline", color: colors.amber, label: { en: "Quick disbursal", hi: "जल्दी पैसा" } },
      { icon: "shield-checkmark-outline", color: colors.green, label: { en: "From RBI-registered lenders", hi: "RBI-रजिस्टर्ड लेंडर्स से" } },
    ],
  },
};

// Plain white header used by the Paytm for Business screens (back arrow or close X, then title).
export function BizHeader({ title, close, right }: { title?: string; close?: boolean; right?: ReactNode }) {
  return (
    <View style={s.header}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        hitSlop={12}
        style={s.headerBtn}
        accessibilityLabel={close ? "Close" : "Back"}
      >
        <Ionicons name={close ? "close" : "arrow-back"} size={26} color={colors.ink} />
      </Pressable>
      {title ? <Txt style={s.headerTitle} numberOfLines={1}>{title}</Txt> : <View style={{ flex: 1 }} />}
      {right}
    </View>
  );
}

const s = StyleSheet.create({
  rule: { width: 16, height: 1.5, backgroundColor: colors.cyan },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff" },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: "700", color: colors.ink, marginLeft: 8 },
});
