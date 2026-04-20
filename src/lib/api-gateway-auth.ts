const BEARER_PREFIX = "bearer ";

function normalizeToken(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function extractBearerToken(authorizationHeader: string | null | undefined) {
  const header = normalizeToken(authorizationHeader);
  if (!header) {
    return "";
  }
  const lower = header.toLowerCase();
  if (!lower.startsWith(BEARER_PREFIX)) {
    return "";
  }
  return header.slice(BEARER_PREFIX.length).trim();
}

export function getGatewayApiKey() {
  return normalizeToken(process.env.SLM_API_GATEWAY_KEY);
}

export function gatewayApiKeyConfigured() {
  return getGatewayApiKey().length > 0;
}

export function requestHasGatewayApiKey(headers: Pick<Headers, "get">) {
  const configuredKey = getGatewayApiKey();
  if (!configuredKey) {
    return false;
  }
  const bearerToken = extractBearerToken(headers.get("authorization"));
  if (bearerToken && bearerToken === configuredKey) {
    return true;
  }
  const xApiKey = normalizeToken(headers.get("x-api-key"));
  return xApiKey.length > 0 && xApiKey === configuredKey;
}
