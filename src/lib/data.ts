import {
  queryFollowups,
  queryQueue,
  queryRules,
  queryStyleProfile,
  querySystemHealth,
  queryThread,
  queryThreads,
  queryTodos,
} from "./convex-server";

export async function getQueuePageData() {
  try {
    const [queue, todos] = await Promise.all([queryQueue(), queryTodos()]);
    return {
      ready: true,
      queue,
      todos,
      error: null,
    };
  } catch (error) {
    return {
      ready: false,
      queue: null,
      todos: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getConversationsPageData(threadId?: string) {
  try {
    const threads = await queryThreads();
    const selectedThreadId = threadId || threads[0]?._id;
    const thread = selectedThreadId ? await queryThread(selectedThreadId) : null;
    return {
      ready: true,
      threads,
      thread,
      error: null,
    };
  } catch (error) {
    return {
      ready: false,
      threads: [],
      thread: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getFollowupsPageData() {
  try {
    const followups = await queryFollowups();
    return { ready: true, followups, error: null };
  } catch (error) {
    return {
      ready: false,
      followups: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getRulesPageData() {
  try {
    const rules = await queryRules();
    return {
      ready: true,
      rules,
      error: null,
    };
  } catch (error) {
    return {
      ready: false,
      rules: { ignoreRules: [], appConfig: [] },
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getStyleLabPageData() {
  try {
    const profile = await queryStyleProfile();
    return {
      ready: true,
      profile,
      error: null,
    };
  } catch (error) {
    return {
      ready: false,
      profile: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getSystemPageData() {
  try {
    const health = await querySystemHealth();
    return {
      ready: true,
      health,
      error: null,
    };
  } catch (error) {
    return {
      ready: false,
      health: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
