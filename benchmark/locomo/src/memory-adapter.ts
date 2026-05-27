/**
 * In-memory implementation of MemoryStorageAdapter for benchmark.
 * This implements the same interface as the production storage adapters.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  MemoryStorageAdapter,
  MemoryRecord,
  MemorySummary,
  MemorySearchQuery,
  MemorySummarySearchQuery,
  MemoryPageResult,
  MemoryLockHandle,
  MemoryListCandidatesInput,
  MemoryTransitionRecordsInput,
  MemoryArchiveRecordDetailsInput,
  MemoryMarkAccessedInput,
} from "./contracts.js";

// Default API ports (dev → local → prod)
export const DEFAULT_PORTS = [3515, 3415, 3414];

/**
 * Find available API port by checking the agent endpoint
 */
export async function findAvailablePort(
  ports: number[] = DEFAULT_PORTS,
): Promise<number> {
  for (const port of ports) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      // Use a minimal agent API call to check if the server is responding
      const response = await fetch(
        `http://localhost:${port}/api/native/agent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: "ping",
            provider: "claude",
            permissionMode: "bypassPermissions",
            skillsConfig: {
              enabled: false,
              userDirEnabled: false,
              appDirEnabled: false,
            },
            mcpConfig: {
              enabled: false,
              userDirEnabled: false,
              appDirEnabled: false,
            },
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timeout);
      if (response.ok || response.status === 400) {
        // 400 means the server responded (bad request is expected for our minimal ping)
        return port;
      }
    } catch {
      // Port not available, try next
    }
  }
  throw new Error(`No available API port found from [${ports.join(", ")}]`);
}

/**
 * Read auth token from ~/.openloomi/token
 */
export function readAuthToken(tokenPath?: string): string | undefined {
  try {
    const path = tokenPath || join(homedir(), ".openloomi", "token");
    return readFileSync(path, "utf-8").trim();
  } catch {
    return undefined;
  }
}

/**
 * Call Agent API with SSE stream and return full text response.
 * The agent API internally has memory search tools built in.
 */
export async function callAgentApi(
  prompt: string,
  port: number,
  authToken?: string,
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  console.log("[Agent] Calling agent API...");
  let response: Response;
  try {
    response = await fetch(`http://localhost:${port}/api/native/agent`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt,
        provider: "claude",
        permissionMode: "bypassPermissions",
        skillsConfig: {
          enabled: true,
          userDirEnabled: true,
          appDirEnabled: false,
        },
        mcpConfig: {
          enabled: true,
          userDirEnabled: true,
          appDirEnabled: false,
        },
      }),
    });
  } catch (fetchError) {
    const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
    const errorCause = fetchError instanceof Error && fetchError.cause ? String(fetchError.cause) : "";
    console.error(`[Agent] Fetch failed: ${errorMessage}${errorCause ? ` (cause: ${errorCause})` : ""}`);
    throw new Error(`Agent API fetch failed: ${errorMessage}${errorCause ? ` (cause: ${errorCause})` : ""}`);
  }
  console.log("[Agent] Response received, status:", response.status);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Agent API error (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is null");
  }

  const decoder = new TextDecoder();
  let fullText = "";
  let messageCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    messageCount++;
    // Parse SSE format: "data: {...}\n\n"
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        try {
          const jsonStr = trimmed.slice(6);
          const msg = JSON.parse(jsonStr);
          if (msg.type === "text" || msg.type === "message") {
            fullText += msg.content || "";
          }
          // Check for final message
          if (msg.type === "done" || msg.done) {
            console.log("[Agent] Done message received");
            break;
          }
        } catch {
          // Skip invalid JSON lines
        }
      }
    }
  }

  console.log("[Agent] Stream complete, messages:", messageCount, "text length:", fullText.length);
  return fullText;
}

/**
 * In-memory storage adapter for memory records (embedding storage).
 */
export class InMemoryStorageAdapter implements MemoryStorageAdapter {
  private records: Map<string, MemoryRecord> = new Map();
  private summaries: Map<string, MemorySummary> = new Map();
  private locks: Map<string, { token: string; expiresAt: number }> = new Map();

  async acquireLock(input: {
    key: string;
    ttlMs: number;
    now: number;
  }): Promise<MemoryLockHandle | null> {
    const existing = this.locks.get(input.key);
    if (existing && existing.expiresAt > input.now) {
      return null; // Lock is held
    }

    const expiresAt = input.now + input.ttlMs;
    const handle: MemoryLockHandle = {
      key: input.key,
      token: `lock_${input.now}_${Math.random()}`,
      acquiredAt: input.now,
      expiresAt,
    };

    this.locks.set(input.key, {
      token: handle.token,
      expiresAt,
    });

    return handle;
  }

  async releaseLock(handle: MemoryLockHandle): Promise<void> {
    const existing = this.locks.get(handle.key);
    if (existing && existing.token === handle.token) {
      this.locks.delete(handle.key);
    }
  }

  async listCandidates(
    input: MemoryListCandidatesInput,
  ): Promise<MemoryRecord[]> {
    const cutoff = input.olderThan;
    return Array.from(this.records.values())
      .filter(
        (r) =>
          r.userId === input.userId &&
          r.tier === input.tier &&
          r.timestamp < cutoff,
      )
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, input.limit);
  }

  async saveSummaries(summaries: MemorySummary[]): Promise<void> {
    for (const summary of summaries) {
      this.summaries.set(summary.summaryId, summary);
    }
  }

  async transitionRecords(input: MemoryTransitionRecordsInput): Promise<void> {
    for (const id of input.ids) {
      const record = this.records.get(id);
      if (record) {
        record.tier = input.toTier;
      }
    }
  }

  async archiveRecordDetails(
    input: MemoryArchiveRecordDetailsInput,
  ): Promise<void> {
    for (const id of input.ids) {
      const record = this.records.get(id);
      if (record) {
        record.archivedAt = input.archivedAt;
      }
    }
  }

  async queryRaw(
    query: MemorySearchQuery,
  ): Promise<MemoryPageResult<MemoryRecord>> {
    let items = Array.from(this.records.values()).filter(
      (r) => r.userId === query.userId && !r.archivedAt,
    );

    if (query.startTime !== undefined) {
      const startTime = query.startTime;
      items = items.filter((r) => r.timestamp >= startTime);
    }
    if (query.endTime !== undefined) {
      const endTime = query.endTime;
      items = items.filter((r) => r.timestamp <= endTime);
    }
    if (query.tiers && query.tiers.length > 0) {
      items = items.filter((r) => query.tiers?.includes(r.tier));
    }

    items.sort((a, b) =>
      query.reverse ? b.timestamp - a.timestamp : a.timestamp - b.timestamp,
    );

    const offset = query.offset ?? 0;
    const pageSize = query.pageSize ?? query.limit ?? 50;
    const start = offset;
    const end = start + pageSize;

    return {
      items: items.slice(start, end),
      hasMore: end < items.length,
      nextOffset: end < items.length ? end : undefined,
      totalApprox: items.length,
    };
  }

  async querySummaries(
    query: MemorySummarySearchQuery,
  ): Promise<MemoryPageResult<MemorySummary>> {
    let items = Array.from(this.summaries.values()).filter(
      (s) => s.userId === query.userId,
    );

    if (query.startTime !== undefined) {
      const startTime = query.startTime;
      items = items.filter((s) => s.endTimestamp >= startTime);
    }
    if (query.endTime !== undefined) {
      const endTime = query.endTime;
      items = items.filter((s) => s.startTimestamp <= endTime);
    }
    if (query.summaryTiers && query.summaryTiers.length > 0) {
      items = items.filter((s) => query.summaryTiers?.includes(s.summaryTier));
    }

    items.sort((a, b) =>
      query.reverse
        ? b.endTimestamp - a.endTimestamp
        : a.endTimestamp - b.endTimestamp,
    );

    const offset = query.offset ?? 0;
    const pageSize = query.pageSize ?? query.limit ?? 50;
    const start = offset;
    const end = start + pageSize;

    return {
      items: items.slice(start, end),
      hasMore: end < items.length,
      nextOffset: end < items.length ? end : undefined,
      totalApprox: items.length,
    };
  }

  async markRecordsAccessed(input: MemoryMarkAccessedInput): Promise<void> {
    for (const id of input.ids) {
      const record = this.records.get(id);
      if (record) {
        record.lastAccessAt = input.at;
        record.accessCount = (record.accessCount ?? 0) + 1;
      }
    }
  }

  // Helper methods for benchmark

  addRecord(record: MemoryRecord): void {
    this.records.set(record.id, { ...record });
  }

  getRecord(id: string): MemoryRecord | undefined {
    return this.records.get(id);
  }

  clear(): void {
    this.records.clear();
    this.summaries.clear();
    this.locks.clear();
  }

  get recordCount(): number {
    return this.records.size;
  }
}
