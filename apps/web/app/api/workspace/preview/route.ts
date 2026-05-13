/**
 * Vite Preview API Routes
 *
 * Manage Vite dev server lifecycle
 */

import { type NextRequest, NextResponse } from "next/server";
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getTaskSessionDir } from "@/lib/files/workspace/sessions";

// Vite process management
const viteProcesses = new Map<
  string,
  { process: any; port: number; startTime: number }
>();

const VITE_PORT_RANGE = { start: 5173, end: 5273 };
const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

/**
 * Check if Node.js is available
 */
// GET /api/workspace/preview/node-available
export async function GET(req: NextRequest) {
  try {
    execSync("node --version", { stdio: "ignore" });
    return NextResponse.json({ available: true });
  } catch {
    return NextResponse.json({ available: false });
  }
}

/**
 * Allocate available port
 */
function allocatePort(): number {
  const usedPorts = new Set(
    Array.from(viteProcesses.values()).map((p) => p.port),
  );

  for (let port = VITE_PORT_RANGE.start; port <= VITE_PORT_RANGE.end; port++) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }

  throw new Error("No available ports for Vite server");
}

/**
 * Start Vite dev server
 */
// POST /api/workspace/preview/start
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 },
      );
    }

    // Check session directory
    const sessionDir = getTaskSessionDir(taskId);
    if (!existsSync(sessionDir)) {
      return NextResponse.json(
        { error: "Task session not found" },
        { status: 404 },
      );
    }

    // Check if there's already a running Vite instance
    const existing = viteProcesses.get(taskId);
    if (existing) {
      // Check if process is still running
      try {
        process.kill(existing.process.pid, 0);
        return NextResponse.json({
          success: true,
          url: `http://localhost:${existing.port}`,
          port: existing.port,
          alreadyRunning: true,
        });
      } catch {
        // Process is dead, clean up
        viteProcesses.delete(taskId);
      }
    }

    // Check package.json and vite.config.js
    const packageJsonPath = join(sessionDir, "package.json");
    const viteConfigPath = join(sessionDir, "vite.config.js");

    if (!existsSync(packageJsonPath) || !existsSync(viteConfigPath)) {
      return NextResponse.json(
        {
          error: "Not a Vite project",
          message: "package.json or vite.config.js not found",
        },
        { status: 400 },
      );
    }

    // Allocate port
    const port = allocatePort();

    // Start Vite
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viteProcess: any = spawn(
      "npm",
      ["run", "dev", "--", "--port", String(port)],
      {
        cwd: sessionDir,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      },
    );

    // Record process
    viteProcesses.set(taskId, {
      process: viteProcess,
      port,
      startTime: Date.now(),
    });

    // Listen to process output (for debugging)
    viteProcess.stdout?.on("data", (data: Buffer) => {
      console.log(`[Vite ${taskId}]`, data.toString());
    });

    viteProcess.stderr?.on("data", (data: Buffer) => {
      console.error(`[Vite ${taskId}]`, data.toString());
    });

    // Clean up on process exit
    viteProcess.on("exit", (code: number) => {
      console.log(`[Vite ${taskId}] Exited with code ${code}`);
      viteProcesses.delete(taskId);
    });

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return NextResponse.json({
      success: true,
      url: `http://localhost:${port}`,
      port,
    });
  } catch (error) {
    console.error("[PreviewAPI] POST error:", error);
    return NextResponse.json(
      {
        error: "Failed to start Vite",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

/**
 * Stop Vite server
 */
// DELETE /api/workspace/preview
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 },
      );
    }

    const viteProcess = viteProcesses.get(taskId);
    if (!viteProcess) {
      return NextResponse.json({
        success: true,
        message: "No Vite process running",
      });
    }

    // Kill process
    try {
      // Kill the entire process tree
      process.kill(-viteProcess.process.pid, "SIGTERM");
      setTimeout(() => {
        try {
          process.kill(-viteProcess.process.pid, "SIGKILL");
        } catch {}
      }, 5000);
    } catch (error) {
      console.error("[PreviewAPI] Failed to kill process:", error);
    }

    viteProcesses.delete(taskId);

    return NextResponse.json({
      success: true,
      message: "Vite server stopped",
    });
  } catch (error) {
    console.error("[PreviewAPI] DELETE error:", error);
    return NextResponse.json(
      {
        error: "Failed to stop Vite",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
