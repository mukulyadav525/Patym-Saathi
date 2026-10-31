import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

/**
 * The merchant's own consent before an approval: the phone's fingerprint / face unlock when the phone has one set
 * up, otherwise the tap itself (plus the approval PIN, which the server checks). Returns false when they cancel.
 * This is a device-side check on top of the server's: approvals are still single-use, payload-bound and PIN-checked.
 */
export async function confirmWithBiometrics(reason: string): Promise<{ ok: boolean; method: "BIOMETRIC" | "TAP" }> {
  if (Platform.OS === "web") return { ok: true, method: "TAP" };
  try {
    const [hardware, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
    if (!hardware || !enrolled) return { ok: true, method: "TAP" };
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: reason, cancelLabel: "Cancel", disableDeviceFallback: false,
    });
    return { ok: res.success, method: "BIOMETRIC" };
  } catch {
    return { ok: true, method: "TAP" }; // a broken sensor must not lock the merchant out; the PIN still applies
  }
}

export async function biometricsAvailable(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}
