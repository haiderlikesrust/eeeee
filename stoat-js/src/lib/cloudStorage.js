import path from 'path';
import fs from 'fs';
import config from '../../config.js';

const useS3 = config.uploadStorage === 's3' && config.s3.bucket && config.s3.region && config.s3.publicBaseUrl;
const UPLOAD_DIR = config.uploadDir;

export function effectiveCloudQuotaBytes(userLean) {
  const q = userLean?.cloud_quota_bytes;
  if (typeof q === 'number' && Number.isFinite(q) && q > 0) return q;
  return config.opicCloudDefaultQuotaBytes;
}

export function formatCloudBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Remove blob from disk or S3. Best-effort; ignores missing files.
 */
export async function deleteStoredBlob(cloudFile) {
  const url = cloudFile?.url;
  const id = cloudFile?._id;
  if (!url || !id) return;

  if (useS3) {
    try {
      const u = new URL(url);
      const key = u.pathname.replace(/^\//, '');
      const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const client = new S3Client({
        region: config.s3.region,
        credentials: config.s3.accessKeyId && config.s3.secretAccessKey
          ? { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey }
          : undefined,
      });
      await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    } catch {
      /* non-fatal */
    }
    return;
  }

  const m = String(url).match(/\/attachments\/([^/?#]+)$/);
  const diskName = m ? m[1] : null;
  if (!diskName) return;
  const filePath = path.join(UPLOAD_DIR, diskName);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
  const ext = path.extname(diskName);
  const base = path.basename(diskName, ext);
  const sidecar = path.join(UPLOAD_DIR, `${base}.ctype.json`);
  try {
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  } catch {
    /* ignore */
  }
}
