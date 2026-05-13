import { NextResponse } from "next/server";
import { z } from "zod";
import { ImapFlow } from "imapflow";
import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";

const OutlookValidateSchema = z.object({
  email: z.email(),
  appPassword: z.string().min(1, "The app password is required"),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = OutlookValidateSchema.parse(body);
    const { email, appPassword } = validatedData;

    const imapClient = new ImapFlow({
      host: "outlook.office365.com",
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
    console.error("[Auth] Outlook auth validate error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((e) => e.message).join(", ") },
        { status: 400 },
      );
    }

    // Check for authentication errors
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();

      // Common IMAP authentication error patterns
      if (
        errorMessage.includes("authentication") ||
        errorMessage.includes("auth") ||
        errorMessage.includes("login") ||
        errorMessage.includes("credentials")
      ) {
        return NextResponse.json(
          {
            error:
              "Authentication failed. Please check your email and app password.",
          },
          { status: 401 },
        );
      }

      // Connection errors
      if (
        errorMessage.includes("connection") ||
        errorMessage.includes("connect") ||
        errorMessage.includes("timeout")
      ) {
        return NextResponse.json(
          {
            error:
              "Could not connect to Outlook server. Please check your network connection and try again.",
          },
          { status: 503 },
        );
      }
    }

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return NextResponse.json(
      {
        error: `Outlook auth validate failed: ${(error as Error).message}`,
      },
      { status: 500 },
    );
  }
}
