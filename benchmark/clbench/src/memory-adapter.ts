/**
 * In-memory implementation of MemoryStorageAdapter for benchmark.
 * This implements the same interface as the production storage adapters.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import net from "node:net";

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
} from "./contracts";

/**
 * Default ports to check for the OpenLoomi API server.
 */
export const DEFAULT_PORTS = [3515];

/**
 * Find an available port where the OpenLoomi API server is running.
 */
export async function findAvailablePort(): Promise<number> {
  for (const port of DEFAULT_PORTS) {
    const available = await checkPortAvailable(port);
    if (!available) {
      return port;
    }
  }
  throw new Error(
    `No OpenLoomi API server found on ports ${DEFAULT_PORTS.join(", ")}. Please start the server first.`,
  );
}

/**
 * Check if a port is in use (server is running).
 */
function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.destroy();
      resolve(false); // port is in use (server running)
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(true); // port is available
    });
    socket.on("error", () => {
      resolve(true); // port is available
    });
    socket.connect(port, "127.0.0.1");
  });
}

/**
 * Read auth token from a file.
 * Defaults to ~/.openloomi/token
 */
export function readAuthToken(tokenPath?: string): string | undefined {
  const filePath = tokenPath ?? join(homedir(), ".openloomi", "token");
  try {
    const token = readFileSync(filePath, "utf-8").trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Call the OpenLoomi agent API with a prompt.
 */
export async function callAgentApi(
  prompt: string,
  port: number,
  authToken?: string,
): Promise<string> {
  const url = `http://127.0.0.1:${port}/api/native/agent`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt,
      provider: "claude",
    }),
    signal: AbortSignal.timeout(2_400_000), // 40 min timeout
  });

  if (!response.ok) {
    throw new Error(
      `Agent API error: ${response.status} ${response.statusText}`,
    );
  }

  // The agent API returns a streaming response, so we need to parse it
  const text = await response.text();

  // Try to extract text from SSE format or plain text
  // The API may return JSON with a text field or SSE data
  try {
    // Check if it's JSON
    const data = JSON.parse(text);
    if (data.text) return data.text;
    if (data.content) return data.content;
    if (data.message) return data.message;
    if (data.result) return data.result;
    // If it has a response field with text
    if (typeof data === "object") {
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === "string" && value.length > 0) {
          return value;
        }
      }
    }
  } catch {
    // Not JSON, treat as plain text
  }

  // Try to extract SSE lines - collect text from type:text events
  const lines = text.split("\n");
  const textParts: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:") || trimmed.startsWith("0:")) {
      try {
        const jsonStr = trimmed.startsWith("data:")
          ? trimmed.slice(5).trim()
          : trimmed.slice(1).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        const parsed = JSON.parse(jsonStr);
        // Only capture type:text events for the actual answer
        if (parsed.type === "text" && parsed.content) {
          textParts.push(parsed.content);
        }
      } catch {
        // continue
      }
    }
  }

  if (textParts.length > 0) {
    return textParts.join("");
  }

  // Return as-is if nothing worked
  return text || "(empty response)";
}

/**
 * Simple in-memory storage adapter for benchmarking.
 * Implements the MemoryStorageAdapter interface.
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
    const now = Date.now();
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
