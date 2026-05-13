/**
 * Audit logger
 *
 * Records non-project file reads and non-project local command executions during program execution.
 * Logs are written in JSONL format to ~/.openloomi/logs/audit.jsonl
 *
 * Note: All Node.js modules are loaded via dynamic require()
 * to avoid Edge Runtime static analysis errors.
 */

function getLogPaths() {
  const { homedir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  const dir = join(homedir(), ".openloomi", "logs");
  const file = join(dir, "audit.jsonl");
  return { dir, file };
}

// Save original fs function references to avoid recursion after being overwritten by interceptors
let _fs: typeof import("node:fs") | null = null;
function getFs() {
  if (!_fs) {
    _fs = require("node:fs") as typeof import("node:fs");
  }
  return _fs;
}

// Single log file max size 10 MB, truncate old logs when exceeded
const MAX_LOG_SIZE = 10 * 1024 * 1024;

function ensureLogDir() {
  try {
    const fs = getFs();
    const { dir } = getLogPaths();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    // Ignore
  }
}

/** Check and truncate log when too large */
function rotateIfNeeded() {
  try {
    const fs = getFs();
    const { file } = getLogPaths();
    if (!fs.existsSync(file)) return;
    const stat = fs.statSync(file);
    if (stat.size > MAX_LOG_SIZE) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      // Keep second half
      const keep = lines.slice(Math.floor(lines.length / 2));
      fs.writeFileSync(file, `${keep.join("\n")}\n`);
    }
  } catch {
    // Ignore
  }
}

export interface AuditEntry {
  timestamp: string;
  type: "file_read" | "command_exec";
  detail: string;
  extra?: Record<string, unknown>;
}

export interface CredentialAccessEntry {
  timestamp: string;
  type: "credential_access";
  accountId: string;
  userId: string;
  action: "read" | "update" | "rotate" | "delete";
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  success: boolean;
  errorMessage?: string;
}

let rotateCounter = 0;

function writeEntry(entry: AuditEntry) {
  try {
    ensureLogDir();
    // Check if truncation is needed every 500 entries
    if (++rotateCounter % 500 === 0) {
      rotateIfNeeded();
    }
    const fs = getFs();
    const { file } = getLogPaths();
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // Ignore
  }
}

/** Log non-project file reads */
export function logFileRead(filePath: string) {
  writeEntry({
    timestamp: new Date().toISOString(),
    type: "file_read",
    detail: filePath,
  });
}

/** Log non-project command executions */
export function logCommandExec(command: string, args?: string[]) {
  writeEntry({
    timestamp: new Date().toISOString(),
    type: "command_exec",
    detail: command,
    extra: args?.length ? { args } : undefined,
  });
}

/** Log credential access operations */
export function logCredentialAccess(params: {
  accountId: string;
  userId: string;
  action: "read" | "update" | "rotate" | "delete";
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  success: boolean;
  errorMessage?: string;
}) {
  const entry: CredentialAccessEntry = {
    timestamp: new Date().toISOString(),
    type: "credential_access",
    accountId: params.accountId,
    userId: params.userId,
    action: params.action,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: params.metadata,
    success: params.success,
    errorMessage: params.errorMessage,
  };

  try {
    ensureLogDir();
    if (++rotateCounter % 500 === 0) {
      rotateIfNeeded();
    }
    const fs = getFs();
    const { file } = getLogPaths();
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // Ignore
  }
}

/** Read audit logs (returns parsed entry array) */
export function readAuditLogs(options?: {
  type?: "file_read" | "command_exec";
  limit?: number;
  offset?: number;
}): { entries: AuditEntry[]; total: number } {
  try {
    const fs = getFs();
    const { file } = getLogPaths();
    if (!fs.existsSync(file)) {
      return { entries: [], total: 0 };
    }
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split("\n").filter(Boolean);

    // Reverse by time (newest first)
    lines.reverse();

    let entries: AuditEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip lines that failed to parse
      }
    }

    // Filter by type
    if (options?.type) {
      entries = entries.filter((e) => e.type === options.type);
    }

    const total = entries.length;
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 200;

    return {
      entries: entries.slice(offset, offset + limit),
      total,
    };
  } catch {
    return { entries: [], total: 0 };
  }
}

/** Clear audit logs */
export function clearAuditLogs() {
  try {
    const fs = getFs();
    const { file } = getLogPaths();
    if (fs.existsSync(file)) {
      fs.writeFileSync(file, "");
    }
  } catch {
    // Ignore
  }
}

export const AUDIT_LOG_PATH = "~/.openloomi/logs/audit.jsonl";
