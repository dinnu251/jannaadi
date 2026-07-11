// GCS upload + Pub/Sub publish, lazy singletons.
import { PubSub } from "@google-cloud/pubsub";
import { GoogleAuth } from "google-auth-library";

const g = globalThis as unknown as { __pubsub?: PubSub; __gauth?: GoogleAuth };

export function pubsub(): PubSub {
  if (!g.__pubsub) g.__pubsub = new PubSub();
  return g.__pubsub;
}

function gauth(): GoogleAuth {
  if (!g.__gauth) g.__gauth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/devstorage.read_write"] });
  return g.__gauth;
}

// Upload media to GCS, return gs:// URI (STT + Gemini fileData both read gs://).
// Direct authenticated PUT to the GCS JSON API instead of @google-cloud/storage's
// .save(): the client's internal PassThrough/readable-stream pipeline breaks inside
// the Next.js standalone bundle ("Cannot call write after a stream was destroyed").
// A single fetch of a Buffer has no streams to destroy — robust everywhere.
export async function uploadMedia(objectPath: string, buf: Buffer, contentType: string): Promise<string> {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) throw new Error("GCS_BUCKET not set — cannot persist media");
  const token = await gauth().getAccessToken();
  if (!token) throw new Error("GCS upload: could not acquire access token (check ADC / service account)");
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: new Uint8Array(buf),
  });
  if (!res.ok) throw new Error(`GCS upload ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return `gs://${bucket}/${objectPath}`;
}

export async function publishSubmission(submissionId: string): Promise<void> {
  await pubsub()
    .topic(process.env.PUBSUB_TOPIC ?? "submissions")
    .publishMessage({ data: Buffer.from(JSON.stringify({ submission_id: submissionId })) });
}
