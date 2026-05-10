/**
 * Local Scheduler for Tauri/Desktop Environment
 * This module provides a client-side scheduler that checks for due jobs periodically
 */

import {
  getDueJobs,
  startJobExecution,
  completeJobExecution,
  recoverStuckJobs,
  cleanupStuckJobs,
} from "./service";
import { executeJob } from "./executor";
import {
  isTauriMode,
  DEFAULT_AI_MODEL,
  AI_PROXY_BASE_URL,
} from "../env/constants";
import { getCloudAuthToken } from "@/lib/auth/token-manager";
import { db } from "../db/index";
import { characters, jobExecutions, scheduledJobs } from "../db/schema";
import { eq } from "drizzle-orm";
import type { ScheduledJob } from "@/lib/db/schema";
import {
  runDailyInsightAnalyticsMaintenanceIfDue,
  runInsightMaintenanceIfDue,
} from "./insight-maintenance";

// Track running jobs to prevent duplicate executions within the same scheduler cycle
const runningJobs = new Set<string>();

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;
const CHECK_INTERVAL = 60 * 1000; // Check every minute

// Store current user ID for filtering jobs (set when scheduler starts)
let schedulerUserId: string | undefined;

/**
 * Set the current user ID for job filtering
 * Called when the scheduler is started via API
 */
export function setSchedulerUserId(userId: string | undefined) {
  schedulerUserId = userId;
}

/**
 * Get the current user ID for job filtering
 */
export function getSchedulerUserId(): string | undefined {
  return schedulerUserId;
}

/**
 * Start the local scheduler
 * This should be called when the app starts
 */
export async function startLocalScheduler() {
  if (schedulerInterval) {
    console.log("[LocalScheduler] Already running");
    return;
  }

  // Only run in Tauri/desktop mode
  if (!isTauriMode()) {
    console.log("[LocalScheduler] Not in Tauri mode, skipping");
    return;
  }

  // Immediately check due jobs (includes recoverStuckJobs internally)
  checkAndExecuteDueJobs();

  // Then check periodically
  schedulerInterval = setInterval(() => {
    checkAndExecuteDueJobs();
  }, CHECK_INTERVAL);
}

/**
 * Stop the local scheduler
 */
export async function stopLocalScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[LocalScheduler] Scheduler stopped");
  }
  // Clear running jobs to prevent stuck entries on shutdown
  runningJobs.clear();

  // Update database to mark all running jobs as interrupted
  const now = new Date();
  const running = await db
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.status, "running"));

  for (const exec of running) {
    await db
      .update(jobExecutions)
      .set({
        status: "interrupted",
        completedAt: now,
        error: "Job was interrupted (application closed)",
      })
      .where(eq(jobExecutions.id, exec.id));

    await db
      .update(scheduledJobs)
      .set({
        lastStatus: "error",
        lastError: "Job was interrupted (application closed)",
        updatedAt: now,
      })
      .where(eq(scheduledJobs.id, exec.jobId));
  }

  if (running.length > 0) {
    console.log(
      `[LocalScheduler] Marked ${running.length} running jobs as interrupted`,
    );
  }
}

// Register cleanup on process exit to prevent jobs from being stuck in runningJobs
// This handles unexpected crashes or process termination
if (typeof process !== "undefined" && process.on) {
  const cleanupHandler = async () => {
    runningJobs.clear();

    // Update database to mark all running jobs as interrupted
    const now = new Date();
    const running = await db
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.status, "running"));

    for (const exec of running) {
      await db
        .update(jobExecutions)
        .set({
          status: "interrupted",
          completedAt: now,
          error: "Job was interrupted (application closed)",
        })
        .where(eq(jobExecutions.id, exec.id));

      await db
        .update(scheduledJobs)
        .set({
          lastStatus: "error",
          lastError: "Job was interrupted (application closed)",
          updatedAt: now,
        })
        .where(eq(scheduledJobs.id, exec.jobId));
    }

    if (running.length > 0) {
      console.log(
        `[LocalScheduler] Marked ${running.length} running jobs as interrupted`,
      );
    }
  };
  process.on("exit", cleanupHandler);
}

/**
 * Check for due jobs and execute them
 */
async function checkAndExecuteDueJobs() {
  if (isProcessing) {
    console.log("[LocalScheduler] Already processing, skipping");
    return;
  }

  isProcessing = true;

  try {
    // First, recover any stuck jobs (runs every minute as part of the scheduler cycle)
    // Jobs running longer than RECOVERY_TIMEOUT_MS (120 min) are considered stuck
    await recoverStuckJobs();

    // Then clean up zombie jobs that have been stuck for over 4 hours
    // These are beyond recovery and are simply deleted
    await cleanupStuckJobs();

    await runDailyInsightAnalyticsMaintenanceIfDue(schedulerUserId);
    await runInsightMaintenanceIfDue(schedulerUserId);

    // Get all jobs that are due to run for the current user
    const dueJobs = await getDueJobs(new Date(), schedulerUserId);

    if (dueJobs.length === 0) {
      return;
    }

    console.log(`[LocalScheduler] Found ${dueJobs.length} due job(s)`);

    // Filter out jobs that are already running (prevent duplicate execution)
    const jobsToRun = dueJobs.filter(
      (job: ScheduledJob) => !runningJobs.has(job.id),
    );

    if (jobsToRun.length === 0) {
      console.log(
        "[LocalScheduler] All due jobs are already running, skipping",
      );
      return;
    }

    console.log(`[LocalScheduler] Will execute ${jobsToRun.length} job(s)`);

    // Execute each due job asynchronously (fire-and-forget)
    for (const job of jobsToRun) {
      // Mark job as running to prevent duplicate execution in the same cycle
      runningJobs.add(job.id);

      try {
        // Phase 1.2: Check Character status before auto-triggering
        const rawJobConfig = job.jobConfig;
        const jobConfigObj =
          typeof rawJobConfig === "string"
            ? JSON.parse(rawJobConfig)
            : rawJobConfig;
        const characterId = jobConfigObj?.characterId as string | undefined;

        if (characterId) {
          const [char] = await db
            .select({ status: characters.status })
            .from(characters)
            .where(eq(characters.id, characterId))
            .limit(1);

          if (char && char.status !== "active") {
            console.log(
              `[LocalScheduler] Character ${characterId} is "${char.status}", skipping job ${job.id}`,
            );
            runningJobs.delete(job.id);
            continue;
          }
        }
        console.log(`[LocalScheduler] Executing job: ${job.id} (${job.name})`);

        // Build modelConfig from cloud auth token (for Tauri mode)
        // Use DEFAULT_AI_MODEL as default model to match manual execution behavior.
        const cloudAuthToken = getCloudAuthToken();
        const selectedModel = (() => {
          const model = (job as any)?.jobConfig?.modelConfig?.model;
          // Treat "default" as "no model specified" so we use the default
          return typeof model === "string" && model !== "default"
            ? model
            : undefined;
        })();

        const effectiveModel = selectedModel || DEFAULT_AI_MODEL;

        const modelConfig =
          isTauriMode() && cloudAuthToken
            ? {
                baseUrl: AI_PROXY_BASE_URL,
                apiKey: cloudAuthToken,
                model: effectiveModel,
              }
            : undefined;

        const context = {
          userId: job.userId,
          jobId: job.id,
          executionId: crypto.randomUUID(),
          triggeredBy: "scheduler" as const,
          modelConfig,
          timezone: (job as any).timezone,
        };

        // Start execution record
        await startJobExecution(context);

        // Serialize jobConfig to string for executeJob
        const jobConfigStr =
          typeof job.jobConfig === "string"
            ? job.jobConfig
            : JSON.stringify(job.jobConfig);

        // Execute job asynchronously - don't wait for completion
        executeJob(context, jobConfigStr, job.description || undefined)
          .then(async (result) => {
            console.log(
              `[LocalScheduler] Job ${job.id} completed:`,
              result.status,
            );
            await completeJobExecution(context, result);
          })
          .catch(async (error) => {
            console.error(`[LocalScheduler] Job ${job.id} failed:`, error);
            try {
              await completeJobExecution(context, {
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                output: "",
                duration: 0,
              });
            } catch (e) {
              console.error(
                "[LocalScheduler] Failed to complete job execution record:",
                e,
              );
              // Ensure job is removed from running set to prevent permanent stuck state
              runningJobs.delete(job.id);
            }
          })
          .finally(() => {
            // Remove job from running set when done
            runningJobs.delete(job.id);
          });
      } catch (error) {
        console.error(`[LocalScheduler] Failed to start job ${job.id}:`, error);
        runningJobs.delete(job.id);
      }
    }
  } catch (error) {
    console.error("[LocalScheduler] Error checking for due jobs:", error);
  } finally {
    // Reset isProcessing after launching all jobs (not after they complete)
    isProcessing = false;
  }
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus() {
  return {
    isRunning: schedulerInterval !== null,
    checkInterval: CHECK_INTERVAL,
  };
}
