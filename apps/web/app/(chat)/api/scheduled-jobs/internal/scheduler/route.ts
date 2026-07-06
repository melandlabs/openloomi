/**
 * Internal API for Local Scheduler
 * This endpoint starts the local scheduler in Tauri/Desktop environment
 */

import { NextResponse } from "next/server";
import {
  startLocalScheduler,
  stopLocalScheduler,
  getSchedulerStatus,
  setSchedulerUserId,
} from "@/lib/cron/local-scheduler";
import { setCloudAuthToken } from "@/lib/auth/token-manager";
import { isTauriMode } from "@/lib/env";
import { auth } from "@/app/(auth)/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  console.log("[SchedulerAPI] GET request received");
  console.log(`   URL: ${request.url}`);
  console.log(`   isTauriMode: ${isTauriMode()}`);

  // Get cloudAuthToken from URL params
  const url = new URL(request.url);
  const cloudAuthToken = url.searchParams.get("cloudAuthToken") || undefined;

  try {
    // Only allow in Tauri mode
    if (!isTauriMode()) {
      console.log("[SchedulerAPI] Not in Tauri mode, returning 400");
      return NextResponse.json(
        {
          error: "Local scheduler is only available in Tauri/Desktop mode",
        },
        { status: 400 },
      );
    }

    // Get current user from session
    let userId: string | undefined;
    try {
      const session = await auth();
      userId = session?.user?.id;
    } catch (e) {
      // auth() may throw when no session exists
      userId = undefined;
    }

    if (!userId) {
      return NextResponse.json(
        {
          error: "User not authenticated",
        },
        { status: 401 },
      );
    }

    // Always refresh the active desktop auth/user context before reporting scheduler state.
    setSchedulerUserId(userId);

    if (cloudAuthToken) {
      setCloudAuthToken(cloudAuthToken);
    } else {
      console.warn(
        "[SchedulerAPI] cloudAuthToken missing; starting scheduler with environment/default auth only",
      );
    }

    // Loop / proactive-execution rows live in scheduled_jobs too. Once we
    // know which desktop user we're servicing, ensure their three loop
    // rows (tick / brief / wrap) are present and reflect current prefs.
    // Soft-fails so the rest of the scheduler boot is unaffected.
    try {
      const { syncLoopJobsForUser } = await import("@/lib/loop");
      await syncLoopJobsForUser(userId);
    } catch (e) {
      console.warn(
        "[SchedulerAPI] Loop job sync failed (non-fatal):",
        e instanceof Error ? e.message : String(e),
      );
    }

    // Start the scheduler if it is not running; subsequent GETs refresh runtime context.
    if (!getSchedulerStatus().isRunning) {
      await startLocalScheduler();
    }

    const status = getSchedulerStatus();
    console.log("[SchedulerAPI] Returning status:", status);

    return NextResponse.json({
      success: true,
      scheduler: status,
    });
  } catch (error) {
    console.error("[SchedulerAPI] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  console.log("[SchedulerAPI] POST request received (stop)");

  try {
    // Only allow in Tauri mode
    if (!isTauriMode()) {
      console.log("[SchedulerAPI] Not in Tauri mode, returning 400");
      return NextResponse.json(
        {
          error: "Local scheduler is only available in Tauri/Desktop mode",
        },
        { status: 400 },
      );
    }

    // Stop the scheduler
    await stopLocalScheduler();
    setCloudAuthToken(undefined);
    console.log("[SchedulerAPI] Scheduler stopped");

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("[SchedulerAPI] Error stopping scheduler:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
