export function getConvexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";
}
