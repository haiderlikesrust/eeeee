/**
 * One-off: scan Message.attachments, create CloudFile rows for uploader-owned files,
 * link first channel/message, reconcile User.cloud_bytes_used per author.
 *
 * Run from repo root: node stoat-js/scripts/backfill-opic-cloud.mjs
 */
import mongoose from 'mongoose';
import { connectDb } from '../src/db/index.js';
import { Message, CloudFile, User, Channel } from '../src/db/models/index.js';

async function main() {
  await connectDb();
  const cursor = Message.find({ 'attachments.0': { $exists: true } })
    .select('channel author attachments created_at')
    .cursor();

  const seenFileIds = new Set((await CloudFile.find({}).select('_id').lean()).map((d) => d._id));
  let scanned = 0;
  let inserted = 0;

  for await (const msg of cursor) {
    scanned += 1;
    const author = msg.author;
    if (!author) continue;
    const ch = await Channel.findById(msg.channel).select('server').lean();
    const serverId = ch?.server ? String(ch.server) : null;
    const atts = Array.isArray(msg.attachments) ? msg.attachments : [];
    for (const att of atts) {
      const id = att?._id;
      if (!id || typeof id !== 'string') continue;
      if (seenFileIds.has(id)) continue;
      const size = Math.max(0, Number(att.size) || 0);
      const filename = String(att.filename || id).slice(0, 512);
      const content_type = String(att.content_type || 'application/octet-stream').slice(0, 128);
      const url = typeof att.url === 'string' ? att.url : `/attachments/${id}`;
      const metadata = att.metadata && typeof att.metadata === 'object' ? att.metadata : {};

      try {
        await CloudFile.create({
          _id: id,
          owner: author,
          filename,
          content_type,
          size,
          url,
          metadata,
          created_at: msg.created_at || new Date(),
          channel_id: String(msg.channel),
          message_id: String(msg._id),
          server_id: serverId,
        });
        seenFileIds.add(id);
        inserted += 1;
      } catch (e) {
        if (e?.code === 11000) {
          seenFileIds.add(id);
          continue;
        }
        console.error('CloudFile insert failed', id, e.message);
      }
    }
  }

  console.log(`Scanned ${scanned} messages with attachments, inserted ${inserted} CloudFile docs.`);

  let linked = 0;
  const noServer = await CloudFile.find({
    $or: [{ server_id: null }, { server_id: { $exists: false } }],
    channel_id: { $nin: [null, ''] },
  }).select('_id channel_id').lean();
  for (const row of noServer) {
    const c = await Channel.findById(row.channel_id).select('server').lean();
    const sid = c?.server ? String(c.server) : null;
    await CloudFile.updateOne({ _id: row._id }, { $set: { server_id: sid } });
    linked += 1;
  }
  console.log(`Updated server_id on ${linked} CloudFile rows (from channel).`);

  const agg = await CloudFile.aggregate([
    { $group: { _id: '$owner', total: { $sum: '$size' } } },
  ]);
  for (const row of agg) {
    await User.updateOne({ _id: row._id }, { $set: { cloud_bytes_used: row.total } });
  }
  console.log(`Reconciled cloud_bytes_used for ${agg.length} users.`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
