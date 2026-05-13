/**
 * Password API Route
 *
 * Handles user password input for sudo commands from the native agent
 * Re-executes the command with the password via stdin
 */

import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import { claudePlugin } from "@/lib/ai/extensions";

// Register Claude Agent plugin
getAgentRegistry().register(claudePlugin);

// Password responses map - stores pending password requests
const passwordResponses = new Map<
  string,
  {
    resolve: (
      result: {
        password: string;
        stdout?: string;
        stderr?: string;
        exitCode?: number;
      } | null,
    ) => void;
    reject: (error: Error) => void;
  }
>();

export { passwordResponses };

// Patterns that indicate sudo password is required
const SUDO_PASSWORD_PATTERNS = [
  /\[sudo\] password for .+:/,
  /^password:.*$/m,
  /sudo: \[sudo\] password for/,
  /sudo: a password is required/,
];

export function detectSudoPasswordPrompt(output: string): boolean {
  return SUDO_PASSWORD_PATTERNS.some((pattern) => pattern.test(output));
}

// Transform sudo command to accept password from stdin
export function transformSudoCommand(command: string): string {
  // Match sudo at the beginning of a command (with possible leading whitespace)
  // and optionally capture any arguments that follow
  return command.replace(
    /(\s*)sudo(\s+)/g,
    (_, leadingSpace, trailingSpace) => {
      return `${leadingSpace}sudo -S -p ''${trailingSpace}`;
    },
  );
}

// Execute a command with password via stdin
async function executeCommandWithPassword(
  command: string,
  password: string,
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { spawn } = require("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(command, [], {
      shell: true,
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("close", (code: number | null) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    // Write password after brief delay to ensure prompt is ready
    setTimeout(() => {
      child.stdin?.write(`${password}\n`);
      child.stdin?.end();
    }, 100);
  });
}

// POST /api/native/agent/password - Submit password for sudo command
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      toolUseID: string;
      password: string;
      originalCommand: string;
      cwd?: string;
    };

    console.log(
      "[PasswordAPI] Password submitted for toolUseID:",
      body.toolUseID,
    );

    // Validate required fields
    if (!body.toolUseID || !body.originalCommand) {
      return Response.json(
        { error: "toolUseID and originalCommand are required" },
        { status: 400 },
      );
    }

    // User cancelled - resolve with null to let command fail gracefully
    if (!body.password) {
      const responseHandler = passwordResponses.get(body.toolUseID);
      if (responseHandler) {
        responseHandler.resolve(null);
        passwordResponses.delete(body.toolUseID);
      }
      return Response.json({ success: true, cancelled: true });
    }

    // Transform sudo command to use -S flag for stdin
    const transformedCmd = transformSudoCommand(body.originalCommand);
    console.log("[PasswordAPI] Executing transformed command:", transformedCmd);

    // Execute with password via stdin
    const result = await executeCommandWithPassword(
      transformedCmd,
      body.password,
      body.cwd,
    );

    console.log(
      "[PasswordAPI] Command result:",
      result.exitCode,
      result.stdout.substring(0, 100),
    );

    // Resolve pending request with result
    const responseHandler = passwordResponses.get(body.toolUseID);
    if (responseHandler) {
      responseHandler.resolve({
        password: body.password,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
      passwordResponses.delete(body.toolUseID);
    }

    return Response.json({ success: true, result });
  } catch (error) {
    console.error("[PasswordAPI] Password submission error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
