export type ManagedSecretDefinition = {
  key: string;
  label: string;
  description: string;
  envNames: string[];
  secret: boolean;
};

export const MANAGED_SECRET_DEFINITIONS: ManagedSecretDefinition[] = [
  {
    key: "azure.ai.endpoint",
    label: "AI endpoint",
    description: "Primary Azure/OpenAI compatible text generation endpoint.",
    envNames: ["AZURE_AI_ENDPOINT", "AZURE_OPENAI_ENDPOINT"],
    secret: false,
  },
  {
    key: "azure.ai.apiKey",
    label: "AI API key",
    description: "Primary server-side AI provider key for managed tenants.",
    envNames: ["AZURE_AI_API_KEY", "AZURE_OPENAI_API_KEY", "OPENAI_API_KEY"],
    secret: true,
  },
  {
    key: "azure.ai.model",
    label: "AI model",
    description: "Default model name for managed tenants.",
    envNames: ["AZURE_AI_MODEL", "AZURE_OPENAI_MODEL"],
    secret: false,
  },
  {
    key: "azure.ai.apiStyle",
    label: "AI API style",
    description: "auto, responses, or chat_completions.",
    envNames: ["AZURE_AI_API_STYLE"],
    secret: false,
  },
  {
    key: "azure.image.endpoint",
    label: "Image endpoint",
    description: "Image generation endpoint for managed meme/media tools.",
    envNames: ["AZURE_AI_IMAGE_ENDPOINT"],
    secret: false,
  },
  {
    key: "azure.image.apiKey",
    label: "Image API key",
    description: "Server-side image generation provider key.",
    envNames: ["AZURE_AI_IMAGE_API_KEY"],
    secret: true,
  },
  {
    key: "azure.image.model",
    label: "Image model",
    description: "Default image model for managed media generation.",
    envNames: ["AZURE_AI_IMAGE_MODEL", "AZURE_OPENAI_IMAGE_MODEL"],
    secret: false,
  },
  {
    key: "azure.video.endpoint",
    label: "Video endpoint",
    description: "Video generation endpoint for managed media tools.",
    envNames: ["AZURE_AI_VIDEO_ENDPOINT", "AZURE_OPENAI_VIDEO_ENDPOINT"],
    secret: false,
  },
  {
    key: "azure.video.apiKey",
    label: "Video API key",
    description: "Server-side video generation provider key.",
    envNames: ["AZURE_AI_VIDEO_API_KEY", "AZURE_OPENAI_VIDEO_API_KEY"],
    secret: true,
  },
  {
    key: "azure.video.model",
    label: "Video model",
    description: "Default video model for managed media generation.",
    envNames: ["AZURE_AI_VIDEO_MODEL", "AZURE_OPENAI_VIDEO_MODEL"],
    secret: false,
  },
  {
    key: "gateway.apiKey",
    label: "Gateway API key",
    description: "Server-side API gateway bearer key.",
    envNames: ["SLM_API_GATEWAY_KEY"],
    secret: true,
  },
  {
    key: "flutterwave.secretKey",
    label: "Flutterwave secret key",
    description: "Server-side Flutterwave key used for subscriptions, storefront checkout, and payout transfers.",
    envNames: ["FLUTTERWAVE_SECRET_KEY", "FLW_SECRET_KEY"],
    secret: true,
  },
  {
    key: "flutterwave.webhookHash",
    label: "Flutterwave webhook hash",
    description: "Webhook verification hash configured in the Flutterwave dashboard.",
    envNames: ["FLUTTERWAVE_WEBHOOK_HASH", "FLW_WEBHOOK_HASH"],
    secret: true,
  },
  {
    key: "flutterwave.personalPlanId",
    label: "Flutterwave personal plan",
    description: "Flutterwave payment plan ID for personal connector subscriptions.",
    envNames: ["FLUTTERWAVE_PERSONAL_PLAN_ID", "FLW_PERSONAL_PLAN_ID"],
    secret: false,
  },
  {
    key: "flutterwave.businessPlanId",
    label: "Flutterwave business plan",
    description: "Flutterwave payment plan ID for business WhatsApp subscriptions.",
    envNames: ["FLUTTERWAVE_BUSINESS_PLAN_ID", "FLW_BUSINESS_PLAN_ID"],
    secret: false,
  },
  {
    key: "billing.personalAmount",
    label: "Personal plan amount",
    description: "Recurring charge amount for the personal connector plan.",
    envNames: ["ODOGWU_PERSONAL_PLAN_AMOUNT", "SLM_PERSONAL_PLAN_AMOUNT"],
    secret: false,
  },
  {
    key: "billing.businessAmount",
    label: "Business plan amount",
    description: "Recurring charge amount for the business WhatsApp plan.",
    envNames: ["ODOGWU_BUSINESS_PLAN_AMOUNT", "SLM_BUSINESS_PLAN_AMOUNT"],
    secret: false,
  },
  {
    key: "billing.currency",
    label: "Billing currency",
    description: "Currency code used for Flutterwave subscription checkout.",
    envNames: ["ODOGWU_BILLING_CURRENCY", "SLM_BILLING_CURRENCY"],
    secret: false,
  },
  {
    key: "billing.redirectBaseUrl",
    label: "Billing redirect base URL",
    description: "Public app URL used for Flutterwave checkout callbacks.",
    envNames: ["ODOGWU_PUBLIC_APP_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_URL"],
    secret: false,
  },
  {
    key: "resend.apiKey",
    label: "Resend API key",
    description: "Server-side Resend key for subscription and tenant report emails.",
    envNames: ["RESEND_API_KEY"],
    secret: true,
  },
  {
    key: "resend.fromEmail",
    label: "Resend from email",
    description: "Verified sender address used for subscription and tenant report emails.",
    envNames: ["RESEND_FROM_EMAIL", "ODOGWU_RESEND_FROM_EMAIL"],
    secret: false,
  },
];

export function getManagedSecretDefinition(key: string) {
  return MANAGED_SECRET_DEFINITIONS.find((definition) => definition.key === key);
}

export function getManagedSecretEnvFallback(key: string, env: NodeJS.ProcessEnv = process.env) {
  const definition = getManagedSecretDefinition(key);
  if (!definition) {
    return "";
  }
  for (const envName of definition.envNames) {
    const value = env[envName]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}
