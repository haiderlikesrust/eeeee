# Performance Analysis & Optimizations

This document summarizes performance issues identified in the stack (stoat-frontend + stoat-js), the optimizations applied, and how to measure further improvements.

---

## 1. Key performance issues identified

### Frontend (React / Vite)


| Issue                                              | Location                   | Impact                                                                                                                                                                                                   |
| -------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unstable context value**                         | `VoiceContext.jsx`         | Every VoiceProvider re-render created a new context object → all `useVoice()` consumers (ChannelSidebar, VoicePanel, VoiceChannelView) re-rendered even when voice state was unchanged.                  |
| **Unstable callbacks passed to memoized children** | `AppLayout.jsx` ServerView | `handleChannelCreated`, `handleServerUpdated`, `handleServerDeleted` were recreated every render → `memo(ChannelSidebar)` re-rendered anyway. Same for `addServer` / `removeServer` passed to ServerBar. |
| **Aggressive message polling**                     | `ChatArea.jsx`             | `setInterval(fetchMessages, 3000)` ran every 3s while a channel was open, adding constant server and React load even when WebSocket already delivers new messages.                                       |
| **Heavy work in render**                           | `ChatArea.jsx`             | Per-message: `renderMessageContent` (regex, emoji lookup, markdown), `isEmojiOnly`, embed/link preview rendering. No memoization of message rows or parsed content.                                      |
| **Many state variables in one component**          | `ChatArea.jsx`             | ~30 `useState` calls in ChatArea; any update re-renders the entire tree (messages list, input, side panels).                                                                                             |


### Backend (Node / Express / MongoDB)


| Issue                                  | Location                                 | Impact                                                                                                                                                                                                    |
| -------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Link preview on critical path**      | `channels.js` POST `/:target/messages`   | `await fetchLinkPreviewsForContent(content, 2)` ran before sending the 201 response and broadcast. External URL fetches can take hundreds of ms to several seconds → high message send latency.           |
| **Message list sort not indexed**      | `channels.js` GET messages, `Message.js` | Messages were sorted by `_id` with filter `channel`, but the only index was `{ channel: 1, created_at: -1 }`. MongoDB could not use the index for `sort({ _id: 1 })` → in-memory sort for large channels. |
| **N round-trips for settings updates** | `sync.js` POST `settings/set`            | Loop with `findOneAndUpdate` per key → N database round-trips for N keys.                                                                                                                                 |
| **No response compression**            | `app.js`                                 | JSON responses were sent uncompressed → larger payloads and slower transfers on slow networks.                                                                                                            |


---

## 2. Optimizations applied

### Frontend

- **VoiceContext** (`VoiceContext.jsx`): Wrapped the provider value in `useMemo` with an explicit dependency array. Consumers now re-render only when voice-related state (e.g. `muted`, `currentChannel`, `remoteScreenStreams`) changes, not on every provider render.
- **AppLayout** (`AppLayout.jsx`): Wrapped `addServer`, `removeServer`, and ServerView’s `handleChannelCreated`, `handleServerUpdated`, `handleServerDeleted` in `useCallback` with stable deps. `memo(ChannelSidebar)` and `memo(ServerBar)` can skip re-renders when parent state unrelated to these callbacks changes.
- **ChatArea** (`ChatArea.jsx`): Increased message poll interval from 3s to 10s. WebSocket still delivers new messages in real time; polling is only a fallback and for consistency, so 10s reduces server and client load without losing real-time feel.

### Backend

- **Message indexes** (`Message.js`): Added compound indexes `{ channel: 1, _id: -1 }` and `{ channel: 1, _id: 1 }` so GET `/channels/:target/messages` can use an index for both ascending and descending sort by `_id` within a channel, avoiding in-memory sorts.
- **Link preview off critical path** (`channels.js`): Message is created, channel updated, author loaded, payload built, broadcast and `res.status(201).json(payload)` run immediately. Link preview is then fetched in the background (fire-and-forget) and the message document updated with `Message.updateOne`. Sending and broadcasting no longer wait on external URL fetches.
- **Sync settings batch** (`sync.js`): Replaced the per-key `findOneAndUpdate` loop with a single `UserSettings.bulkWrite(ops)` of `updateOne` operations with `upsert: true`. One round-trip to MongoDB instead of N.
- **Response compression** (`app.js`): Added `compression()` middleware so JSON (and other compressible responses) are gzip/deflate compressed, reducing payload size and improving network efficiency.

---

## 3. Further recommendations (not yet implemented)

- **ChatArea**: Extract a `MessageRow` component and wrap it in `React.memo`; pass only `msg` and stable callbacks so only changed messages re-render. Consider memoizing `renderMessageContent` output per message (e.g. by `msg._id` + content hash) to avoid repeated regex/emoji work.
- **ChatArea**: Debounce or throttle the autocomplete effect (e.g. 150–200 ms) so it doesn’t run on every keystroke with large `mentionDirectory`/`roleDirectory`.
- **Backend**: Cache `Member.find({ server })` (or server → member IDs) in memory with a short TTL (e.g. 5–10 s) in `broadcastToChannel`/`broadcastToServer` to avoid a DB query on every broadcast. Invalidate or TTL on member join/leave/role change.
- **Backend**: Consider moving link preview to a small background job or queue so failures and timeouts don’t touch the request at all; current fire-and-forget is already a big improvement.
- **API GET cache** (`api.js`): Normalize cache key by full URL (including query string) so `?limit=50` and `?limit=50&before=xyz` don’t share the same cache entry inappropriately.
- **Bundle**: Keep using lazy-loaded routes and vendor chunks (Vite `manualChunks`) to minimize initial JS and improve cacheability.

---

## 4. How to measure improvements

### Frontend

- **React DevTools Profiler**: Record a session while switching channels, sending messages, and toggling voice/screen share. Compare re-render counts and duration before/after the context and callback changes. Focus on ChannelSidebar, ServerBar, VoicePanel, and ChatArea.
- **Chrome DevTools Performance**: Record loading the app and opening a channel; check Main thread activity, Long Tasks, and layout/paint. Use “Reduce polling” (10s) to see less periodic work.
- **Bundle**: `npm run build` and inspect `dist/` chunk sizes; ensure routes are code-split and vendor chunk is separate.

### Backend

- **MongoDB**: Use `explain()` on the messages query:  
`Message.find({ channel }).sort({ _id: -1 }).limit(50).explain('executionStats')`  
Confirm `stage: 'IXSCAN'` and index name includes `channel_1_id_-1` (or similar).
- **Latency**: Measure POST `/channels/:id/messages` with and without link preview on the critical path (e.g. `curl -w '%{time_total}'` or APM). You should see a clear drop in p99 once preview is async.
- **Sync**: For `POST /sync/settings/set` with many keys, measure response time and MongoDB `bulkWrite` duration; compare to previous N × `findOneAndUpdate`.

### Network

- **Compression**: In DevTools Network tab, check response headers for `Content-Encoding: gzip` (or br) and compare response sizes for large JSON payloads (e.g. message list, server list).

---

## 5. Tools and commands

- **React**: React DevTools → Profiler tab; enable “Record why each component rendered” if available.
- **Node**: `node --inspect` + Chrome `chrome://inspect` for CPU/memory profiling; or use `clinic.js` (e.g. `npx clinic doctor -- node src/index.js`).
- **MongoDB**: `db.messages.find({ channel: '...' }).sort({ _id: -1 }).limit(50).explain('executionStats')`.
- **Load**: `wrk` or `autocannon` for simple HTTP throughput/latency tests against key routes.

