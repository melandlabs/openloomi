import { TelegramAdapter } from "@openloomi/integrations/telegram/adapter";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  ensureRedis,
  expireTime,
  setLoginSession,
  getLoginSession,
  deleteLoginSession,
  type LoginSession,
} from "@/lib/session/context";
import type { Api } from "telegram";

const passwordIsEmptyError = "Password is empty";
const codeIsEmptyError = "Code is empty";
// Wait interval (milliseconds)
const WAIT_INTERVAL = 1000;
// Max wait attempts
const MAX_WAIT_ATTEMPTS = 120;

export async function POST(request: Request) {
  try {
    await ensureRedis();

    const { phone, sessionId } = await request.json();

    if (sessionId) {
      console.log(`[Auth] Delete session ${sessionId}`);
      await deleteLoginSession(sessionId);
    }

    if (!phone || !/^\+[1-9]\d{1,14}$/.test(phone)) {
      return NextResponse.json(
        { error: "Please provide a valid phone number (E.164 format)" },
        { status: 400 },
      );
    }

    const newSessionId = uuidv4();
    const createdAt = Date.now();

    const adapter = new TelegramAdapter({
      appId: Number(process.env.TG_APP_ID),
      appHash: process.env.TG_APP_HASH || "",
    });

    try {
      await adapter.client.connect();
    } catch (connectError) {
      console.error("[Auth] Telegram connection failed:", connectError);
      return NextResponse.json(
        { error: "Failed to connect to Telegram servers" },
        { status: 500 },
      );
    }

    // Initialize session data and store to Redis
    const initialSession = {
      phone,
      status: "pending" as const,
      createdAt,
    };

    const sessionStored = await setLoginSession(newSessionId, initialSession);
    if (!sessionStored) {
      return NextResponse.json(
        { error: "Failed to initialize login session" },
        { status: 500 },
      );
    }

    console.log(`[Auth] Created session: ${newSessionId}`);

    (async () => {
      try {
        const apiCredentials = {
          apiId: adapter.appId,
          apiHash: adapter.appHash,
        };

        let user: Api.TypeUser;

        if (!(await adapter.client.checkAuthorization())) {
          console.log(`[Auth] Session: ${newSessionId} sign in`);
          user = await adapter.client.signInUser(apiCredentials, {
            phoneNumber: phone,
            password: async () => {
              console.log(`[Auth] Session: ${newSessionId} enter password`);
              // Mark session as requiring password
              const session = await getLoginSession(newSessionId);
              if (session) {
                session.status = "password_required";
                session.error = undefined;
                console.log(`[Auth] Session: ${newSessionId} set password`);
                await setLoginSession(newSessionId, session);
              }
              // Wait for password submission from frontend
              return new Promise((resolve) => {
                const interval = setInterval(async () => {
                  const currentSession = await getLoginSession(newSessionId);
                  if (!currentSession) {
                    clearInterval(interval);
                    return resolve("");
                  }
                  if (
                    currentSession.status === "password_submitted" &&
                    currentSession.password
                  ) {
                    clearInterval(interval);
                    console.log(
                      `[Auth] Session ${newSessionId} resolve password`,
                    );
                    return resolve(currentSession.password);
                  }

                  if (Date.now() - currentSession.createdAt > expireTime) {
                    clearInterval(interval);
                    currentSession.status = "error";
                    currentSession.error = "Password input timed out";
                    await setLoginSession(newSessionId, currentSession);
                    return resolve("");
                  }
                }, 1000);
              });
            },
            phoneCode: async () => {
              console.log(`[Auth] Session: ${newSessionId} enter phone code`);
              // Mark session as requiring password
              const session = await getLoginSession(newSessionId);
              if (session) {
                session.status = "code_required";
                session.error = undefined;
                console.log(`[Auth] Session: ${newSessionId} set phone code`);
                await setLoginSession(newSessionId, session);
              }

              return new Promise((resolve) => {
                const checkInterval = setInterval(async () => {
                  const currentSession = await getLoginSession(newSessionId);
                  if (!currentSession) {
                    clearInterval(checkInterval);
                    resolve("");
                    return;
                  }

                  if (
                    currentSession.status === "code_submitted" &&
                    currentSession.code
                  ) {
                    clearInterval(checkInterval);
                    console.log(`[Auth] Session ${newSessionId} resolve code`);
                    resolve(currentSession.code);
                  }

                  if (Date.now() - currentSession.createdAt > expireTime) {
                    clearInterval(checkInterval);
                    currentSession.status = "error";
                    currentSession.error = "Verification code timed out";
                    await setLoginSession(newSessionId, currentSession);
                    resolve("");
                  }
                }, 1000);
              });
            },
            // Deal auth errors
            onError: async (err) => {
              console.error(
                `[Auth] Error in telegram login flow: ${err.message} for session ${newSessionId}`,
              );
              const session = await getLoginSession(newSessionId);
              if (session) {
                session.status = "error";
                session.error = err.message || "Authentication failed";
                await setLoginSession(newSessionId, session);
              } else {
                console.error(`[Auth] Session ${newSessionId} not found`);
                // Return true to raise a AUTH_USER_CANCEL error
                return true;
              }
              // Empty code and password here denotes the session is expired or not found
              // Need to login again
              if (
                err.message.includes(passwordIsEmptyError) ||
                err.message.includes(codeIsEmptyError)
              ) {
                return true;
              }
              return false;
            },
          });
        } else {
          console.log(`[Auth] Session: ${newSessionId} has been signed in`);
          user = await adapter.client.getMe();
        }

        const me = await adapter.client.getMe();
        const session = await getLoginSession(newSessionId);
        if (session) {
          session.status = "completed";
          session.result = { id: user.id.toJSNumber() };
          session.tgSession = adapter.session.save();
          session.user = {
            firstName: me.firstName,
            lastName: me.lastName,
            userName: me.username,
          };
          await setLoginSession(newSessionId, session);
          console.log(`[Auth] Session ${newSessionId} completed successfully`);
        }
      } catch (error) {
        console.error(
          `[Auth] Login process failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        const session = await getLoginSession(newSessionId);
        if (session) {
          session.status = "error";
          session.error =
            error instanceof Error ? error.message : "Login process failed";
          await setLoginSession(newSessionId, session);
        }
      } finally {
        try {
          await adapter.client.disconnect();
        } catch (disconnectErr) {
          console.error("[Auth] telegram disconnect error:", disconnectErr);
        }
      }
    })();

    let attempts = 0;
    let resultSession: LoginSession | null = initialSession;

    while (attempts < MAX_WAIT_ATTEMPTS) {
      // Wait for a while
      await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL));

      resultSession = await getLoginSession(newSessionId);

      if (!resultSession) {
        return NextResponse.json(
          { error: "Session expired or not found" },
          { status: 400 },
        );
      }

      if (resultSession.status === "code_required") {
        return NextResponse.json({
          sessionId: newSessionId,
          success: true,
          requiresCode: true,
        });
      }

      if (resultSession.status === "error") {
        return NextResponse.json(
          { error: resultSession.error || "Authentication failed" },
          { status: 400 },
        );
      }

      attempts++;
    }

    return NextResponse.json(
      { error: "Login timed out, please reopen this window and try again." },
      { status: 400 },
    );
  } catch (error) {
    console.error(
      `[Auth] Initialization error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      { error: "Failed to initialize login process" },
      { status: 500 },
    );
  }
}
