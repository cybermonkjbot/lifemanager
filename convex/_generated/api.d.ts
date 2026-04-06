/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as draft from "../draft.js";
import type * as followups from "../followups.js";
import type * as followupsMarkQueued from "../followupsMarkQueued.js";
import type * as followupsPromoter from "../followupsPromoter.js";
import type * as grounding from "../grounding.js";
import type * as inbound from "../inbound.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_heuristics from "../lib/heuristics.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_types from "../lib/types.js";
import type * as media from "../media.js";
import type * as memory from "../memory.js";
import type * as memoryBatch from "../memoryBatch.js";
import type * as outbox from "../outbox.js";
import type * as outreach from "../outreach.js";
import type * as personality from "../personality.js";
import type * as queue from "../queue.js";
import type * as retention from "../retention.js";
import type * as rules from "../rules.js";
import type * as settings from "../settings.js";
import type * as style from "../style.js";
import type * as system from "../system.js";
import type * as threads from "../threads.js";
import type * as todos from "../todos.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  draft: typeof draft;
  followups: typeof followups;
  followupsMarkQueued: typeof followupsMarkQueued;
  followupsPromoter: typeof followupsPromoter;
  grounding: typeof grounding;
  inbound: typeof inbound;
  "lib/config": typeof lib_config;
  "lib/constants": typeof lib_constants;
  "lib/heuristics": typeof lib_heuristics;
  "lib/time": typeof lib_time;
  "lib/types": typeof lib_types;
  media: typeof media;
  memory: typeof memory;
  memoryBatch: typeof memoryBatch;
  outbox: typeof outbox;
  outreach: typeof outreach;
  personality: typeof personality;
  queue: typeof queue;
  retention: typeof retention;
  rules: typeof rules;
  settings: typeof settings;
  style: typeof style;
  system: typeof system;
  threads: typeof threads;
  todos: typeof todos;
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
