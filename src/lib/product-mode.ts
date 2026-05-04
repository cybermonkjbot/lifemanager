import { readLocalInstanceConfig } from "@/lib/instance-config";

export type ProductUse = "personal" | "business";

export async function getLocalProductUse(): Promise<ProductUse> {
  const config = await readLocalInstanceConfig();
  return config?.preferences.productUse === "business" ? "business" : "personal";
}

export function isBusinessUse(productUse: ProductUse | undefined) {
  return productUse === "business";
}
