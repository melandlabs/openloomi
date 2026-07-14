export type ImageGenerationUsageStatus = "success" | "failed";

export type ImageGenerationUsageRecord = {
  userId: string | null;
  endpoint: "api/ai/v1/images/generations";
  provider: string;
  model: string;
  imageCount: number;
  creditsUsed: number;
  status: ImageGenerationUsageStatus;
  errorType?: string;
  costMode: "estimated";
  quotaMode: "record_only";
  createdAt: Date;
};

type ImageGenerationUsageRecorder = (
  record: ImageGenerationUsageRecord,
) => Promise<void> | void;

let usageRecorder: ImageGenerationUsageRecorder = async () => {};

export async function recordImageGenerationUsage(
  record: ImageGenerationUsageRecord,
): Promise<void> {
  await usageRecorder(record);
}

export function __setImageGenerationUsageRecorderForTests(
  recorder: ImageGenerationUsageRecorder,
): void {
  usageRecorder = recorder;
}

export function __resetImageGenerationUsageRecorderForTests(): void {
  usageRecorder = async () => {};
}
