import { router } from "expo-router";
import { Alert } from "react-native";

import { AddProductForm } from "@/components/AddProductForm";
import { Screen, TopBar } from "@/components/ui";
import { api } from "@/lib/api";

export default function AddProductScreen() {
  return (
    <Screen>
      <TopBar title="Add a product" />
      <AddProductForm note="Saathi finds it by name straight away: on the Soundbox, in bills and in questions."
        onSubmit={async (d) => {
          const item = await api.addProduct({ name: d.name.trim(), name_hi: d.name_hi.trim() || null, pack_label: d.pack_label.trim() || "1 pack",
            sell_price: d.sell_price, opening_stock: Number(d.stock || 0), cost_price: d.cost_price || null });
          Alert.alert("Added", `${item.name} (${item.pack_label}) is in your inventory with ${item.usable_packs} in stock.`);
          if (router.canGoBack()) router.back();
          else router.replace("/inventory");
        }} />
    </Screen>
  );
}
