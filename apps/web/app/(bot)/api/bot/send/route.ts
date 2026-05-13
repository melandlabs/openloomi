import { auth } from "@/app/(auth)/auth";
import { sendMessage } from "@/lib/bots/message-service";
import { AppError } from "@openloomi/shared/errors";
import sanitizeHtml from "sanitize-html";

interface SendMessageBody {
  botId: string;
  recipients: string[];
  message: string;
  messageHtml?: string;
  withAppSuffix?: boolean;
  cc?: string[];
  bcc?: string[];
  attachments?: Array<{
    url: string;
    name?: string;
    contentType?: string;
  }>;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:bot").toResponse();
  }

  try {
    let body: SendMessageBody;
    try {
      body = await req.json();
    } catch (parseError) {
      return new AppError(
        "bad_request:bot",
        "Invalid JSON format",
      ).toResponse();
    }

    const {
      botId,
      recipients,
      message,
      messageHtml,
      withAppSuffix,
      attachments,
      cc,
      bcc,
    } = body;

    const shouldAppendAppSuffix = true;

    // Validate required fields
    const requiredFields = ["botId", "recipients", "message"] as const;
    const missingFields = requiredFields.filter((field) => !(field in body));

    if (missingFields.length > 0) {
      return new AppError(
        "bad_request:bot",
        `Missing fields in the request: ${missingFields.join(", ")}`,
      ).toResponse();
    }

    // Sanitize and prepare parameters
    const sanitizeList = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];

    const sanitizedRecipients = sanitizeList(recipients);
    const sanitizedCc = sanitizeList(cc);
    const sanitizedBcc = sanitizeList(bcc);

    const sanitizedAttachments = Array.isArray(attachments)
      ? attachments
          .filter(
            (
              item,
            ): item is NonNullable<SendMessageBody["attachments"]>[number] =>
              typeof item === "object" &&
              item !== null &&
              typeof item.url === "string" &&
              item.url.trim().length > 0,
          )
          .map((item, index) => ({
            url: item.url.trim(),
            name:
              typeof item.name === "string" && item.name.trim().length > 0
                ? item.name.trim()
                : `attachment-${index + 1}`,
            contentType:
              typeof item.contentType === "string" &&
              item.contentType.trim().length > 0
                ? item.contentType.trim()
                : "application/octet-stream",
          }))
      : [];

    // Send message using the service layer
    const result = await sendMessage(
      {
        botId,
        recipients: sanitizedRecipients,
        message,
        messageHtml:
          typeof messageHtml === "string"
            ? sanitizeHtml(messageHtml)
            : undefined,
        cc: sanitizedCc.length > 0 ? sanitizedCc : undefined,
        bcc: sanitizedBcc.length > 0 ? sanitizedBcc : undefined,
        attachments:
          sanitizedAttachments.length > 0 ? sanitizedAttachments : undefined,
        withAppSuffix: shouldAppendAppSuffix,
      },
      session.user.id,
    );

    // Return result
    if (result.success) {
      return Response.json(
        {
          success: true,
          recipients: result.recipients,
          message: result.message,
        },
        { status: 200 },
      );
    } else {
      // Handle skipped (e.g., manual bots)
      if (result.skipped) {
        return Response.json(
          {
            success: false,
            skipped: true,
            message: result.message,
          },
          { status: 200 },
        );
      }

      // Handle error
      return Response.json(
        {
          success: false,
          error: result.error,
        },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error("[API /bot/send] Error:", error);
    return new AppError(
      "bad_request:bot",
      `${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
