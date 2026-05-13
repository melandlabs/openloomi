import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { readAuditLogs, clearAuditLogs } from "@openloomi/audit";

/**
 * GET /api/audit/logs
 * Get audit log list, supports pagination and type filtering
 *
 * Query params:
 *   type   - Optional, "file_read" | "command_exec"
 *   limit  - Items per page, default 200
 *   offset - Offset amount, default 0
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const type = searchParams.get("type") as "file_read" | "command_exec" | null;
  const limit = Number(searchParams.get("limit")) || 200;
  const offset = Number(searchParams.get("offset")) || 0;

  const result = readAuditLogs({
    type: type ?? undefined,
    limit,
    offset,
  });

  return NextResponse.json(result);
}

/**
 * DELETE /api/audit/logs
 * Clear audit logs
 */
export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  clearAuditLogs();
  return NextResponse.json({ ok: true });
}
