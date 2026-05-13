import { TelegramAdapter } from "@openloomi/integrations/telegram/adapter";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  ensureRedis,
  expireTime,
  getLoginSession,
  setLoginSession,
} from "@/lib/session/context";

const passwordIsEmptyError = "Password is empty";

export async function POST(request: Request) {
  try {
    // Create new session ID
    const sessionId = uuidv4();
    const createdAt = Date.now();

    // Initialize Telegram adapter
    const adapter = new TelegramAdapter({
      appId: Number(process.env.TG_APP_ID),
      appHash: process.env.TG_APP_HASH || "",
    });

    try {
      // Connect to Telegram server
      await adapter.client.connect();
    } catch (connectError) {
      console.error("[QR Auth] Telegram connection failed:", connectError);
      return NextResponse.json(
        { error: "Failed to connect to Telegram servers" },
        { status: 500 },
      );
    }

    // Store initial session state
    const initialSession = {
      status: "pending" as const,
      createdAt,
      phone: "",
      qrUrl: "",
      token: "",
    };

    await ensureRedis();
    await setLoginSession(sessionId, initialSession);
    console.log(`[QR Auth] Created QR session: ${sessionId}`);

    // Handle QR login flow in async task
    (async () => {
      try {
        const apiCredentials = {
          apiId: adapter.appId,
          apiHash: adapter.appHash,
        };

        // Start QR login flow
        const user = await adapter.client.signInUserWithQrCode(apiCredentials, {
          qrCode: async (code) => {
            // Generate QR code URL
            const token = code.token.toString("base64url");
            const qrUrl = `tg://login?token=${token}`;
            // Update session status, save QR code info
            const session = await getLoginSession(sessionId);
            if (session) {
              session.status = "qr_generated";
              session.qrUrl = qrUrl;
              session.token = token;
              console.log(`[QR Auth] Session ${sessionId} generated QR code`);
              await setLoginSession(sessionId, session);
            }
          },
          password: async () => {
            // Mark session as requiring password
            const session = await getLoginSession(sessionId);
            if (session) {
              session.status = "password_required";
              session.error = undefined;
              console.log(`[Auth] Session: ${sessionId} qr set password`);
              await setLoginSession(sessionId, session);
            }
            // Wait for password submission from frontend
            return new Promise((resolve) => {
              const interval = setInterval(async () => {
                const currentSession = await getLoginSession(sessionId);
                if (!currentSession) {
                  clearInterval(interval);
                  return resolve("");
                }
                if (
                  currentSession.status === "password_submitted" &&
                  currentSession.password
                ) {
                  clearInterval(interval);
                  console.log(`[Auth] Session ${sessionId} resolve password`);
                  return resolve(currentSession.password);
                }

                if (Date.now() - currentSession.createdAt > expireTime) {
                  clearInterval(interval);
                  currentSession.status = "error";
                  currentSession.error = "Password input timed out";
                  await setLoginSession(sessionId, currentSession);
                  return resolve("");
                }
              }, 1000);
            });
          },
          onError: async (err) => {
            console.error(
              `[QR Auth] Error in QR login flow: ${err.message} for session ${sessionId}`,
            );
            // Update session status to error
            const session = await getLoginSession(sessionId);
            if (session) {
              session.status = "error";
              session.error = err.message || "QR Authentication failed";
              await setLoginSession(sessionId, session);
            } else {
              console.error(`[Auth] Session ${sessionId} not found`);
              // Return true to raise a AUTH_USER_CANCEL error
              return true;
            }
            // Empty code and password here denotes the session is expired or not found
            // Need to login again
            if (err.message.includes(passwordIsEmptyError)) {
              return true;
            }
            return false;
          },
        });

        // Login successful, update session info
        const me = await adapter.client.getMe();
        const session = await getLoginSession(sessionId);

        if (session) {
          session.status = "completed";
          session.result = { id: user.id.toJSNumber() };
          session.tgSession = adapter.session.save();
          session.user = {
            firstName: me.firstName,
            lastName: me.lastName,
            userName: me.username,
          };
          await setLoginSession(sessionId, session);
          console.log(`[QR Auth] Session ${sessionId} completed successfully`);
        }
      } catch (error) {
        console.error(
          `[QR Auth] QR login process failed: ${error instanceof Error ? error.message : String(error)}`,
        );

        // Record error state
        const session = await getLoginSession(sessionId);
        if (session) {
          session.status = "error";
          session.error =
            error instanceof Error ? error.message : "QR Login process failed";
          await setLoginSession(sessionId, session);
        }
      } finally {
        // Ensure disconnect
        try {
          await adapter.client.disconnect();
        } catch (disconnectErr) {
          console.error("[QR Auth] Telegram disconnect error:", disconnectErr);
        }
      }
    })();

    // Wait for QR code generation
    let attempts = 0;
    while (attempts < 10) {
      // Wait up to 10 seconds
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const session = await getLoginSession(sessionId);
      if (session?.status === "qr_generated" && session.qrUrl) {
        return NextResponse.json({
          sessionId,
          qrUrl: session.qrUrl,
          success: true,
        });
      }

      if (session?.status === "error") {
        return NextResponse.json(
          { error: session.error || "Failed to generate QR code" },
          { status: 400 },
        );
      }

      attempts++;
    }

    return NextResponse.json(
      { error: "Timeout generating QR code" },
      { status: 408 },
    );
  } catch (error) {
    console.error(
      `[QR Auth] Initialization error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      { error: "Failed to initialize QR login process" },
      { status: 500 },
    );
  }
}
