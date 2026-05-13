import { NextResponse } from "next/server";
import { z } from "zod";
import { ImapFlow } from "imapflow";
import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";

const GoogleValidateSchema = z.object({
  email: z.email("Please enter a valid email address"),
  appPassword: z
    .string()
    .min(16, "The app password must be at least 16 characters")
    .max(16, "The app password cannot exceed 16 characters"),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = GoogleValidateSchema.parse(body);
    const { email, appPassword } = validatedData;
    const imapClient = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: {
        user: email,
        pass: appPassword,
      },
      tls: {
        rejectUnauthorized: true,
      },
      logger: false,
      connectionTimeout: 15_000,
    });

    await imapClient.connect();

    const userInfo = {
      email,
      name: email.split("@")[0],
    };
    await imapClient.logout();
    return NextResponse.json(
      {
        success: true,
        name: userInfo.name,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Auth] Google auth validate error:", error);

    // Check AppError and ZodError first before generic handling
    if (error instanceof AppError) {
      return error.toResponse();
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => e.message).join(", ") },
        { status: 400 },
      );
    }

    const err = error as NodeJS.ErrnoException & { code?: string };
    const errorMessage = (error as Error).message?.toLowerCase() ?? "";

    // Check for network errors
    const isNetworkError =
      err?.code === "ECONNRESET" ||
      err?.code === "ETIMEDOUT" ||
      err?.code === "ENOTFOUND" ||
      err?.code === "ECONNREFUSED" ||
      err?.code === "EPIPE" ||
      err?.message?.includes("secure TLS connection") ||
      err?.message?.includes("socket closed") ||
      err?.message?.includes("socket hang up") ||
      err?.message?.includes("connection reset") ||
      err?.message?.includes("not open") ||
      err?.message?.includes("eof") ||
      err?.message?.includes("premature close") ||
      err?.message?.includes("read econnreset");

    if (isNetworkError) {
      return NextResponse.json(
        {
          errorCode: "GOOGLE_AUTH_NETWORK_ERROR",
          error: "Unable to connect to Gmail server",
        },
        { status: 503 },
      );
    }

    // Check for 2-Step Verification not enabled
    if (errorMessage.includes("web login required")) {
      return NextResponse.json(
        {
          errorCode: "GOOGLE_AUTH_2FA_NOT_ENABLED",
          error: "2-Step Verification not enabled",
        },
        { status: 401 },
      );
    }

    // Check for too many failed attempts
    if (errorMessage.includes("too many failed")) {
      return NextResponse.json(
        {
          errorCode: "GOOGLE_AUTH_TOO_MANY_ATTEMPTS",
          error: "Too many failed login attempts",
        },
        { status: 401 },
      );
    }

    // Check for account disabled
    if (errorMessage.includes("account disabled")) {
      return NextResponse.json(
        {
          errorCode: "GOOGLE_AUTH_ACCOUNT_DISABLED",
          error: "Account has been disabled",
        },
        { status: 401 },
      );
    }

    // Check for invalid password / bad credentials
    const isInvalidPassword =
      errorMessage.includes("authentication failed") ||
      errorMessage.includes("invalid credentials") ||
      errorMessage.includes("auth failed") ||
      errorMessage.includes("login failed") ||
      errorMessage.includes("bad user") ||
      errorMessage.includes("login info") ||
      errorMessage.includes("command failed");

    if (isInvalidPassword) {
      return NextResponse.json(
        {
          errorCode: "GOOGLE_AUTH_INVALID_PASSWORD",
          error: "Invalid App Password",
        },
        { status: 401 },
      );
    }

    // Try to extract more details from imapflow error
    const imapError = error as {
      message?: string;
      responseText?: string;
      responseCode?: string;
    };

    const detailedInfo = imapError.responseText
      ? ` (server response: ${imapError.responseText})`
      : "";

    return NextResponse.json(
      {
        error: `Google auth validate failed: ${(error as Error).message}${detailedInfo}`,
      },
      { status: 500 },
    );
  }
}
