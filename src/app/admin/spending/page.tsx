import { AdminLivePage } from "@/components/admin-live-page";
import { LiveSpending } from "@/components/live-spending";

function normalizeModelEnvKey(model: string) {
  return model
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default async function AdminSpendingPage() {
  const model = (process.env.AZURE_AI_MODEL || process.env.AZURE_OPENAI_MODEL || "").trim();
  const normalizedModel = model ? normalizeModelEnvKey(model) : "";
  const modelInput = normalizedModel ? process.env[`SLM_AI_COST_${normalizedModel}_INPUT_PER_1M_USD`] : undefined;
  const modelOutput = normalizedModel ? process.env[`SLM_AI_COST_${normalizedModel}_OUTPUT_PER_1M_USD`] : undefined;
  const inputRateRaw = modelInput || process.env.SLM_AI_COST_AZURE_INPUT_PER_1M_USD || process.env.SLM_AI_COST_DEFAULT_INPUT_PER_1M_USD;
  const outputRateRaw =
    modelOutput || process.env.SLM_AI_COST_AZURE_OUTPUT_PER_1M_USD || process.env.SLM_AI_COST_DEFAULT_OUTPUT_PER_1M_USD;
  const inputRate = inputRateRaw ? Number(inputRateRaw) : undefined;
  const outputRate = outputRateRaw ? Number(outputRateRaw) : undefined;
  const hasEnvPricing =
    Number.isFinite(inputRate) && Number.isFinite(outputRate) && (inputRate as number) >= 0 && (outputRate as number) >= 0;

  return (
    <AdminLivePage title="Spending" nextPath="/admin/spending">
      <LiveSpending
        initialInputRatePer1MUsd={hasEnvPricing ? (inputRate as number) : undefined}
        initialOutputRatePer1MUsd={hasEnvPricing ? (outputRate as number) : undefined}
        hideManualPricingInputs={hasEnvPricing}
      />
    </AdminLivePage>
  );
}
