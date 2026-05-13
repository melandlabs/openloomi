import { z } from "zod";

import { SUPPORTED_ATTACHMENT_MIME_TYPES_ARRAY } from "@/lib/files/config";
import { messageMetadataSchema } from "@openloomi/shared";

const attachmentMimeEnum = z.enum(SUPPORTED_ATTACHMENT_MIME_TYPES_ARRAY);

const textPartSchema = z.object({
  type: z.enum(["text"]),
  text: z.string().min(1).max(2000),
});

const filePartSchema = z.object({
  type: z.enum(["file"]),
  mediaType: attachmentMimeEnum,
  name: z.string().min(1).max(200),
  url: z.url(),
  sizeBytes: z.number().int().positive().optional(),
  blobPath: z.string().min(1).max(512).optional(),
  downloadUrl: z.url().optional(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

export const postRequestBodySchema = z.object({
  id: z.uuid(),
  message: z.object({
    id: z.uuid(),
    role: z.enum(["user"]),
    parts: z.array(partSchema),
    metadata: messageMetadataSchema.optional(),
  }),
  selectedVisibilityType: z.enum(["public", "private"]),
  platformAccountId: z.uuid().optional().nullable(),
  agentMode: z.boolean().optional(),
  focusedInsightIds: z.array(z.string()).optional(), // Reference context events (choose one with referencedContextInsightIds, backward compatible)
  referencedContextInsightIds: z.array(z.string()).optional(), // Reference context events
  cloudAuthToken: z.string().optional(),
  model: z.string().optional(), // Model selected by user (optional, defaults to system default)
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
