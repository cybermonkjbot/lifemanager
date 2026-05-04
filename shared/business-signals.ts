export type BusinessIntent =
  | "none"
  | "pricing"
  | "availability"
  | "order"
  | "payment"
  | "delivery"
  | "complaint"
  | "refund"
  | "booking";

export type BusinessSignalAssessment = {
  intent: BusinessIntent;
  labels: string[];
  scoreBoost: number;
  urgent: boolean;
};

const SIGNALS: Array<{
  intent: Exclude<BusinessIntent, "none">;
  label: string;
  boost: number;
  urgent?: boolean;
  patterns: RegExp[];
}> = [
  {
    intent: "pricing",
    label: "Price asked",
    boost: 16,
    patterns: [/\b(price|cost|how much|amount|rate|charges?|quote|quotation|discount|last price)\b/i, /\b(?:₦|ngn|naira|\$)\s?\d+/i],
  },
  {
    intent: "availability",
    label: "Availability",
    boost: 12,
    patterns: [/\b(available|in stock|stock|still have|do you have|can i get|remaining|sold out)\b/i],
  },
  {
    intent: "order",
    label: "Order intent",
    boost: 18,
    urgent: true,
    patterns: [/\b(order|buy|purchase|take one|i want|i need|send me|book mine|reserve|checkout)\b/i],
  },
  {
    intent: "payment",
    label: "Payment",
    boost: 20,
    urgent: true,
    patterns: [/\b(payment|pay|paid|transfer|account number|acct|receipt|proof of payment|transaction|bank details)\b/i],
  },
  {
    intent: "delivery",
    label: "Delivery",
    boost: 14,
    patterns: [/\b(delivery|deliver|dispatch|rider|waybill|shipping|address|location|pickup|pick up|drop off)\b/i],
  },
  {
    intent: "complaint",
    label: "Complaint",
    boost: 24,
    urgent: true,
    patterns: [/\b(complaint|complain|issue|problem|wrong item|damaged|not working|bad service|delay|late|angry|disappointed)\b/i],
  },
  {
    intent: "refund",
    label: "Refund",
    boost: 26,
    urgent: true,
    patterns: [/\b(refund|return|cancel order|money back|reverse payment|chargeback)\b/i],
  },
  {
    intent: "booking",
    label: "Booking",
    boost: 14,
    patterns: [/\b(appointment|booking|book a slot|schedule|available time|reservation|consultation)\b/i],
  },
];

export function assessBusinessSignal(text: string): BusinessSignalAssessment {
  const labels: string[] = [];
  let scoreBoost = 0;
  let urgent = false;
  let intent: BusinessIntent = "none";

  for (const signal of SIGNALS) {
    if (!signal.patterns.some((pattern) => pattern.test(text))) {
      continue;
    }
    labels.push(signal.label);
    scoreBoost = Math.max(scoreBoost, signal.boost);
    urgent = urgent || Boolean(signal.urgent);
    if (intent === "none" || signal.boost > (SIGNALS.find((item) => item.intent === intent)?.boost || 0)) {
      intent = signal.intent;
    }
  }

  return {
    intent,
    labels,
    scoreBoost,
    urgent,
  };
}
