// GCS upload + Pub/Sub publish, lazy singletons.
import { Storage } from "@google-cloud/storage";
import { PubSub } from "@google-cloud/pubsub";

const g = globalThis as unknown as { __gcs?: Storage; __pubsub?: PubSub };

function storage(): Storage {
  if (!g.__gcs) g.__gcs = new Storage();
  return g.__gcs;
}

export function pubsub(): PubSub {
  if (!g.__pubsub) g.__pubsub = new PubSub();
  return g.__pubsub;
}

// Upload media to GCS, return gs:// URI (STT + Gemini fileData both read gs://).
export async function uploadMedia(objectPath: string, buf: Buffer, contentType: string): Promise<string> {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) throw new Error("GCS_BUCKET not set — cannot persist media");
  await storage().bucket(bucket).file(objectPath).save(buf, { contentType, resumable: false });
  return `gs://${bucket}/${objectPath}`;
}

export async function publishSubmission(submissionId: string): Promise<void> {
  await pubsub()
    .topic(process.env.PUBSUB_TOPIC ?? "submissions")
    .publishMessage({ data: Buffer.from(JSON.stringify({ submission_id: submissionId })) });
}
