/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminPlatform from "../adminPlatform.js";
import type * as adminSecrets from "../adminSecrets.js";
import type * as adminUsers from "../adminUsers.js";
import type * as aiFeedback from "../aiFeedback.js";
import type * as backlog from "../backlog.js";
import type * as billing from "../billing.js";
import type * as billingActions from "../billingActions.js";
import type * as calls from "../calls.js";
import type * as chatTools from "../chatTools.js";
import type * as code from "../code.js";
import type * as connectedAccounts from "../connectedAccounts.js";
import type * as contextTools from "../contextTools.js";
import type * as conversationIntelligence from "../conversationIntelligence.js";
import type * as conversationQuality from "../conversationQuality.js";
import type * as conversationQualityActions from "../conversationQualityActions.js";
import type * as crons from "../crons.js";
import type * as draft from "../draft.js";
import type * as followups from "../followups.js";
import type * as followupsMarkQueued from "../followupsMarkQueued.js";
import type * as followupsPromoter from "../followupsPromoter.js";
import type * as grounding from "../grounding.js";
import type * as inbound from "../inbound.js";
import type * as instagramActions from "../instagramActions.js";
import type * as lib_aiSmartness from "../lib/aiSmartness.js";
import type * as lib_aliasNormalization from "../lib/aliasNormalization.js";
import type * as lib_billingAccess from "../lib/billingAccess.js";
import type * as lib_commitments from "../lib/commitments.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_conversationIntelligence from "../lib/conversationIntelligence.js";
import type * as lib_conversationQuality from "../lib/conversationQuality.js";
import type * as lib_emojiLearning from "../lib/emojiLearning.js";
import type * as lib_heuristics from "../lib/heuristics.js";
import type * as lib_memePolicy from "../lib/memePolicy.js";
import type * as lib_outboundGuard from "../lib/outboundGuard.js";
import type * as lib_outboxEnqueue from "../lib/outboxEnqueue.js";
import type * as lib_outreachModes from "../lib/outreachModes.js";
import type * as lib_personaPacks from "../lib/personaPacks.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_staleness from "../lib/staleness.js";
import type * as lib_storefrontProfile from "../lib/storefrontProfile.js";
import type * as lib_tenantSecurity from "../lib/tenantSecurity.js";
import type * as lib_threadEligibility from "../lib/threadEligibility.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_types from "../lib/types.js";
import type * as lib_urlPreview from "../lib/urlPreview.js";
import type * as media from "../media.js";
import type * as memory from "../memory.js";
import type * as memoryBatch from "../memoryBatch.js";
import type * as migrationsProviders from "../migrationsProviders.js";
import type * as outbox from "../outbox.js";
import type * as outreach from "../outreach.js";
import type * as personality from "../personality.js";
import type * as queue from "../queue.js";
import type * as queueStaleSweeper from "../queueStaleSweeper.js";
import type * as rateLimits from "../rateLimits.js";
import type * as relationshipState from "../relationshipState.js";
import type * as retention from "../retention.js";
import type * as romanceProtocol from "../romanceProtocol.js";
import type * as rules from "../rules.js";
import type * as settings from "../settings.js";
import type * as statusBuilder from "../statusBuilder.js";
import type * as storefront from "../storefront.js";
import type * as style from "../style.js";
import type * as system from "../system.js";
import type * as tenantAccounts from "../tenantAccounts.js";
import type * as threads from "../threads.js";
import type * as todos from "../todos.js";
import type * as urlPreviews from "../urlPreviews.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminPlatform: typeof adminPlatform;
  adminSecrets: typeof adminSecrets;
  adminUsers: typeof adminUsers;
  aiFeedback: typeof aiFeedback;
  backlog: typeof backlog;
  billing: typeof billing;
  billingActions: typeof billingActions;
  calls: typeof calls;
  chatTools: typeof chatTools;
  code: typeof code;
  connectedAccounts: typeof connectedAccounts;
  contextTools: typeof contextTools;
  conversationIntelligence: typeof conversationIntelligence;
  conversationQuality: typeof conversationQuality;
  conversationQualityActions: typeof conversationQualityActions;
  crons: typeof crons;
  draft: typeof draft;
  followups: typeof followups;
  followupsMarkQueued: typeof followupsMarkQueued;
  followupsPromoter: typeof followupsPromoter;
  grounding: typeof grounding;
  inbound: typeof inbound;
  instagramActions: typeof instagramActions;
  "lib/aiSmartness": typeof lib_aiSmartness;
  "lib/aliasNormalization": typeof lib_aliasNormalization;
  "lib/billingAccess": typeof lib_billingAccess;
  "lib/commitments": typeof lib_commitments;
  "lib/config": typeof lib_config;
  "lib/constants": typeof lib_constants;
  "lib/conversationIntelligence": typeof lib_conversationIntelligence;
  "lib/conversationQuality": typeof lib_conversationQuality;
  "lib/emojiLearning": typeof lib_emojiLearning;
  "lib/heuristics": typeof lib_heuristics;
  "lib/memePolicy": typeof lib_memePolicy;
  "lib/outboundGuard": typeof lib_outboundGuard;
  "lib/outboxEnqueue": typeof lib_outboxEnqueue;
  "lib/outreachModes": typeof lib_outreachModes;
  "lib/personaPacks": typeof lib_personaPacks;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/staleness": typeof lib_staleness;
  "lib/storefrontProfile": typeof lib_storefrontProfile;
  "lib/tenantSecurity": typeof lib_tenantSecurity;
  "lib/threadEligibility": typeof lib_threadEligibility;
  "lib/time": typeof lib_time;
  "lib/types": typeof lib_types;
  "lib/urlPreview": typeof lib_urlPreview;
  media: typeof media;
  memory: typeof memory;
  memoryBatch: typeof memoryBatch;
  migrationsProviders: typeof migrationsProviders;
  outbox: typeof outbox;
  outreach: typeof outreach;
  personality: typeof personality;
  queue: typeof queue;
  queueStaleSweeper: typeof queueStaleSweeper;
  rateLimits: typeof rateLimits;
  relationshipState: typeof relationshipState;
  retention: typeof retention;
  romanceProtocol: typeof romanceProtocol;
  rules: typeof rules;
  settings: typeof settings;
  statusBuilder: typeof statusBuilder;
  storefront: typeof storefront;
  style: typeof style;
  system: typeof system;
  tenantAccounts: typeof tenantAccounts;
  threads: typeof threads;
  todos: typeof todos;
  urlPreviews: typeof urlPreviews;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
