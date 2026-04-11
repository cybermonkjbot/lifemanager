import assert from "node:assert/strict";
import test from "node:test";

import { pickCanonicalAssetForDedupe, resolveAssetRegistrationMatch } from "./media";

test("resolveAssetRegistrationMatch prefers sticker provider hash matches", () => {
  const providerMatch = {
    _id: "asset_provider" as never,
    kind: "sticker" as const,
    contentHash: "content-a",
    providerContentHash: "provider-a",
  };
  const contentMatch = {
    _id: "asset_content" as never,
    kind: "sticker" as const,
    contentHash: "content-a",
    providerContentHash: undefined,
  };

  const resolved = resolveAssetRegistrationMatch({
    kind: "sticker",
    normalizedContentHash: "content-a",
    normalizedProviderContentHash: "provider-a",
    existingByProviderContentHash: providerMatch,
    existingByContentHash: contentMatch,
  });

  assert.equal(resolved.existing?._id, providerMatch._id);
  assert.equal(resolved.matchedBy, "providerContentHash");
  assert.equal(resolved.shouldPatchProviderContentHash, false);
});

test("resolveAssetRegistrationMatch falls back to content hash and requests provider-hash patch when missing", () => {
  const contentMatch = {
    _id: "asset_content" as never,
    kind: "sticker" as const,
    contentHash: "content-a",
    providerContentHash: undefined,
  };

  const resolved = resolveAssetRegistrationMatch({
    kind: "sticker",
    normalizedContentHash: "content-a",
    normalizedProviderContentHash: "provider-a",
    existingByProviderContentHash: null,
    existingByContentHash: contentMatch,
  });

  assert.equal(resolved.existing?._id, contentMatch._id);
  assert.equal(resolved.matchedBy, "contentHash");
  assert.equal(resolved.shouldPatchProviderContentHash, true);
});

test("resolveAssetRegistrationMatch does not patch for non-sticker kinds", () => {
  const contentMatch = {
    _id: "asset_content" as never,
    kind: "meme" as const,
    contentHash: "content-a",
    providerContentHash: undefined,
  };

  const resolved = resolveAssetRegistrationMatch({
    kind: "meme",
    normalizedContentHash: "content-a",
    normalizedProviderContentHash: "provider-a",
    existingByProviderContentHash: null,
    existingByContentHash: contentMatch,
  });

  assert.equal(resolved.existing?._id, contentMatch._id);
  assert.equal(resolved.matchedBy, "contentHash");
  assert.equal(resolved.shouldPatchProviderContentHash, false);
});

test("pickCanonicalAssetForDedupe keeps richer enabled asset and is deterministic", () => {
  const older = {
    _id: "asset_a",
    _creationTime: 1000,
    kind: "sticker",
    enabled: true,
    tags: ["a", "b"],
    label: "Older",
    contentHash: "1111",
    providerContentHash: undefined,
    contextSummary: undefined,
    contextTags: undefined,
    contextTriggers: undefined,
    contextAvoid: undefined,
    contextConfidence: undefined,
    generationContextSnippet: undefined,
  } as never;
  const richer = {
    _id: "asset_b",
    _creationTime: 2000,
    kind: "sticker",
    enabled: true,
    tags: ["a", "b", "c"],
    label: "Richer",
    contentHash: "1111",
    providerContentHash: "aaaa",
    contextSummary: "summary",
    contextTags: ["tag"],
    contextTriggers: ["trigger"],
    contextAvoid: ["avoid"],
    contextConfidence: 0.8,
    generationContextSnippet: "ctx",
  } as never;

  const picked = pickCanonicalAssetForDedupe([older, richer]);
  assert.equal(picked?._id, "asset_b");

  const tieOne = {
    ...older,
    _id: "asset_c",
    _creationTime: 900,
    tags: [],
    label: "Tie",
  } as never;
  const tieTwo = {
    ...older,
    _id: "asset_d",
    _creationTime: 900,
    tags: [],
    label: "Tie",
  } as never;

  const tiePicked = pickCanonicalAssetForDedupe([tieTwo, tieOne]);
  assert.equal(tiePicked?._id, "asset_c");
});
