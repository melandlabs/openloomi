/**
 * Permission Response API Route
 *
 * Handles user responses to permission requests from the native agent
 */

import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { permissionResponses } from "@/lib/ai/native-agent/permissions";

// POST /api/native/agent/permission - Handle permission response from frontend
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      toolUseID: string;
      behavior: "allow" | "deny";
      updatedInput?: Record<string, unknown>;
    };

    console.log("[PermissionAPI] Permission response:", body);

    const responseHandler = permissionResponses.get(body.toolUseID);
    if (!responseHandler) {
      console.error(
        `[PermissionAPI] No pending permission request for toolUseID: ${body.toolUseID}`,
      );
      return Response.json(
        { error: "Invalid toolUseID or request already handled" },
        { status: 404 },
      );
    }

    // Resolve the promise with the user's decision
    responseHandler.resolve({
      behavior: body.behavior,
      updatedInput: body.updatedInput,
    });

    // Clean up
    permissionResponses.delete(body.toolUseID);

    return Response.json({ success: true });
  } catch (error) {
    console.error("[PermissionAPI] Permission response error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
