import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";

// Device-only preferences (language, notification switches). Nothing here is sent to the API.
const KEY = "saathi.prefs";

export type Lang = "en" | "hi";
export type NotifyPrefs = { soundbox: boolean; push: boolean; sms: boolean; settlement: boolean };
type Prefs = { lang: Lang; notify: NotifyPrefs; wakeWord: boolean; speakReplies: boolean };

const DEFAULTS: Prefs = {
  lang: "en", notify: { soundbox: true, push: true, sms: false, settlement: true }, wakeWord: true, speakReplies: true,
};

const store = {
  get: async () => (Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) ?? null : SecureStore.getItemAsync(KEY)),
  set: async (v: string) => (Platform.OS === "web" ? globalThis.localStorage?.setItem(KEY, v) : SecureStore.setItemAsync(KEY, v)),
};

const STRINGS = {
  en: {
    appTitle: "Paytm All-in-One Business App",
    tagline: "Growth partner for your business",
    saathiTitle: "Paytm Saathi",
    saathiSub: "Your AI business partner. Plan stock, collect dues — you approve every step.",
    saathiCta: "Open Saathi",
    newBadge: "NEW",
    qr: "Get All-in-One QR",
    soundbox: "Buy Soundbox",
    card: "Buy Card Machine",
    loan: "Get Merchant Loan",
    login: "Login or Become a Merchant",
    continueAs: "Continue as",
    settlements: "Payments and Settlements",
    notifications: "Payment Notifications",
    approvalPin: "Approval PIN",
    language: "Change Language",
    legal: "Legal and Privacy Policy",
    signOut: "Sign out",
    notSignedIn: "You're not logged in",
    notSignedInSub: "Login to see payments, settlements and Saathi",
    features: "Features",
    prototype: "Prototype screen · no request is sent",
    requestInfo: "Request callback",
  },
  hi: {
    appTitle: "Paytm ऑल-इन-वन बिज़नेस ऐप",
    tagline: "आपके बिज़नेस का ग्रोथ पार्टनर",
    saathiTitle: "Paytm साथी",
    saathiSub: "आपका AI बिज़नेस पार्टनर। स्टॉक प्लान करें, बकाया वसूलें — हर कदम आपकी मंज़ूरी से।",
    saathiCta: "साथी खोलें",
    newBadge: "नया",
    qr: "ऑल-इन-वन QR पाएं",
    soundbox: "साउंडबॉक्स खरीदें",
    card: "कार्ड मशीन खरीदें",
    loan: "मर्चेंट लोन पाएं",
    login: "लॉगिन करें या मर्चेंट बनें",
    continueAs: "जारी रखें:",
    settlements: "पेमेंट और सेटलमेंट",
    notifications: "पेमेंट नोटिफ़िकेशन",
    approvalPin: "मंज़ूरी PIN",
    language: "भाषा बदलें",
    legal: "कानूनी और प्राइवेसी पॉलिसी",
    signOut: "साइन आउट",
    notSignedIn: "आप लॉगिन नहीं हैं",
    notSignedInSub: "पेमेंट, सेटलमेंट और साथी देखने के लिए लॉगिन करें",
    features: "फ़ीचर्स",
    prototype: "प्रोटोटाइप स्क्रीन · कोई रिक्वेस्ट नहीं भेजी जाती",
    requestInfo: "कॉलबैक मांगें",
  },
} as const;

export type StringKey = keyof (typeof STRINGS)["en"];

type PrefsState = Prefs & {
  t: (k: StringKey) => string;
  setLang: (l: Lang) => void;
  setNotify: (k: keyof NotifyPrefs, v: boolean) => void;
  setWakeWord: (v: boolean) => void;
  setSpeakReplies: (v: boolean) => void;
};

const PrefsContext = createContext<PrefsState | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    store.get().then((v) => {
      if (v) setPrefs({ ...DEFAULTS, ...(JSON.parse(v) as Partial<Prefs>) });
    }).catch(() => undefined);
  }, []);

  const update = useCallback((next: (p: Prefs) => Prefs) => {
    setPrefs((p) => {
      const n = next(p);
      void store.set(JSON.stringify(n)).catch(() => undefined);
      return n;
    });
  }, []);

  const value = useMemo<PrefsState>(() => ({
    ...prefs,
    t: (k) => STRINGS[prefs.lang][k],
    setLang: (lang) => update((p) => ({ ...p, lang })),
    setNotify: (k, v) => update((p) => ({ ...p, notify: { ...p.notify, [k]: v } })),
    setWakeWord: (v) => update((p) => ({ ...p, wakeWord: v })),
    setSpeakReplies: (v) => update((p) => ({ ...p, speakReplies: v })),
  }), [prefs, update]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs outside PrefsProvider");
  return ctx;
}
