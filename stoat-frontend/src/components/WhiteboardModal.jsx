import { useEffect, useRef, useCallback, useState } from 'react';
import { post, uploadFile } from '../api';
import { useWS } from '../context/WebSocketContext';
import './WhiteboardModal.css';

const BG = '#f8f9fc';
const DRAWING_SEND_MS = 33;

function colorForUserId(userId) {
  const s = String(userId ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360}, 65%, 48%)`;
}

function drawStroke(ctx, op, cw, ch) {
  const pts = op.points;
  if (!Array.isArray(pts) || pts.length < 2) return;
  const isEraser = op.tool === 'eraser';
  const lw = typeof op.width === 'number' ? op.width : 3;
  const color = op.color || colorForUserId(op.user_id);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = (lw / 800) * Math.min(cw, ch);
  if (isEraser) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
  }
  ctx.beginPath();
  const p0 = pts[0];
  ctx.moveTo(p0.x * cw, p0.y * ch);
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i];
    ctx.lineTo(p.x * cw, p.y * ch);
  }
  ctx.stroke();
  ctx.restore();
}

function newStrokeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

const POINTER_SEND_MS = 50;

function defaultResolveDisplayName(uid) {
  const s = String(uid ?? '');
  return s.length > 6 ? `…${s.slice(-4)}` : s || '?';
}

function WhiteboardModal({
  sessionId,
  channelId,
  ownerId,
  userId,
  onClose,
  resolveDisplayName = defaultResolveDisplayName,
}) {
  const { send, on } = useWS();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const opsRef = useRef([]);
  const drawingRef = useRef(null);
  const lastPtrSendRef = useRef(0);
  const remotePreviewsRef = useRef(new Map());
  const strokeIdRef = useRef(null);
  const drawingSendIndexRef = useRef(0);
  const lastDrawingSendRef = useRef(0);
  const [status, setStatus] = useState('');
  const [closing, setClosing] = useState(false);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#1e1e2e');
  const [width, setWidth] = useState(4);
  const [cursors, setCursors] = useState(() => new Map());
  const [participants, setParticipants] = useState(() => new Set());
  const isOwner = userId != null && ownerId != null && String(userId) === String(ownerId);

  const redrawCanvasComposite = useCallback((canvas, localDraft) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.fillStyle = BG;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillRect(0, 0, cw, ch);
    for (const op of opsRef.current) {
      if (op?.kind === 'stroke') drawStroke(ctx, op, cw, ch);
    }
    for (const [, preview] of remotePreviewsRef.current) {
      if (preview.points.length >= 2) {
        drawStroke(ctx, {
          kind: 'stroke',
          points: preview.points,
          color: preview.color,
          width: preview.width,
          tool: preview.tool,
          user_id: preview.user_id,
        }, cw, ch);
      }
    }
    if (localDraft && localDraft.points && localDraft.points.length >= 2) {
      drawStroke(ctx, { kind: 'stroke', ...localDraft, user_id: userId }, cw, ch);
    }
  }, [userId]);

  const pushOp = useCallback((op) => {
    if (op?.kind === 'clear_board') {
      opsRef.current = [];
      remotePreviewsRef.current.clear();
    } else {
      opsRef.current = [...opsRef.current, op];
    }
    const c = canvasRef.current;
    if (c) redrawCanvasComposite(c, drawingRef.current);
  }, [redrawCanvasComposite]);

  const maybeSendDrawingDelta = useCallback(() => {
    const d = drawingRef.current;
    if (!d || !strokeIdRef.current) return;
    const from = drawingSendIndexRef.current;
    if (from >= d.points.length) return;
    const now = Date.now();
    if (now - lastDrawingSendRef.current < DRAWING_SEND_MS) return;
    lastDrawingSendRef.current = now;
    const delta = d.points.slice(from);
    drawingSendIndexRef.current = d.points.length;
    send({
      type: 'WhiteboardDrawing',
      sessionId,
      strokeId: strokeIdRef.current,
      points_delta: delta,
      color: d.color,
      width: d.width,
      tool: d.tool,
    });
  }, [send, sessionId]);

  /** Send any points not yet streamed (e.g. on pointer up, bypass throttle). */
  const flushDrawingDelta = useCallback(() => {
    const d = drawingRef.current;
    if (!d || !strokeIdRef.current) return;
    const from = drawingSendIndexRef.current;
    if (from >= d.points.length) return;
    const delta = d.points.slice(from);
    drawingSendIndexRef.current = d.points.length;
    lastDrawingSendRef.current = Date.now();
    send({
      type: 'WhiteboardDrawing',
      sessionId,
      strokeId: strokeIdRef.current,
      points_delta: delta,
      color: d.color,
      width: d.width,
      tool: d.tool,
    });
  }, [send, sessionId]);

  const sendPointerIfDue = useCallback((nx, ny) => {
    const now = Date.now();
    if (now - lastPtrSendRef.current < POINTER_SEND_MS) return;
    lastPtrSendRef.current = now;
    send({ type: 'WhiteboardPointer', sessionId, x: nx, y: ny });
  }, [send, sessionId]);

  useEffect(() => {
    const mergeRemoteDrawing = (d) => {
      if (!d || String(d.session_id) !== String(sessionId) || !d.stroke_id) return;
      if (String(d.user_id) === String(userId)) return;
      const sid = String(d.stroke_id);
      const delta = d.points_delta;
      if (!Array.isArray(delta) || delta.length === 0) return;
      let entry = remotePreviewsRef.current.get(sid);
      if (!entry || String(entry.user_id) !== String(d.user_id)) {
        entry = {
          user_id: d.user_id,
          points: [],
          color: d.color,
          width: d.width,
          tool: d.tool || 'pen',
        };
      }
      entry.points = [...entry.points, ...delta];
      if (d.color != null) entry.color = d.color;
      if (d.width != null) entry.width = d.width;
      if (d.tool != null) entry.tool = d.tool;
      remotePreviewsRef.current.set(sid, entry);
      redrawCanvasComposite(canvasRef.current, drawingRef.current);
    };

    const unState = on('WhiteboardState', (d) => {
      if (!d || String(d.session_id) !== String(sessionId)) return;
      opsRef.current = Array.isArray(d.ops) ? [...d.ops] : [];
      remotePreviewsRef.current.clear();
      const c = canvasRef.current;
      if (c) redrawCanvasComposite(c, drawingRef.current);
    });
    const unOp = on('WhiteboardOp', (d) => {
      if (!d || String(d.session_id) !== String(sessionId) || !d.op) return;
      if (d.op.stroke_id) remotePreviewsRef.current.delete(String(d.op.stroke_id));
      pushOp(d.op);
    });
    const unDrawing = on('WhiteboardDrawing', mergeRemoteDrawing);
    const unPtr = on('WhiteboardPointer', (d) => {
      if (!d || String(d.session_id) !== String(sessionId) || !d.user_id) return;
      if (String(d.user_id) === String(userId)) return;
      setCursors((prev) => {
        const next = new Map(prev);
        next.set(String(d.user_id), { x: d.x, y: d.y });
        return next;
      });
    });
    const unJoin = on('WhiteboardParticipantJoin', (d) => {
      if (!d || String(d.session_id) !== String(sessionId) || !d.user_id) return;
      setParticipants((prev) => new Set(prev).add(String(d.user_id)));
    });
    const unLeave = on('WhiteboardParticipantLeave', (d) => {
      if (!d || String(d.session_id) !== String(sessionId) || !d.user_id) return;
      setParticipants((prev) => {
        const next = new Set(prev);
        next.delete(String(d.user_id));
        return next;
      });
      setCursors((prev) => {
        const next = new Map(prev);
        next.delete(String(d.user_id));
        return next;
      });
    });
    const unErr = on('WhiteboardError', (d) => {
      if (d?.session_id && String(d.session_id) !== String(sessionId)) return;
      if (d?.code === 'session_not_found') setStatus('Session ended or not found.');
      if (d?.code === 'rate_limited') setStatus('Slow down — too many strokes.');
    });
    const unClosed = on('WhiteboardSessionClosed', (d) => {
      if (!d || String(d.session_id) !== String(sessionId)) return;
      onClose?.();
    });
    send({ type: 'WhiteboardJoin', sessionId });
    return () => {
      unState();
      unOp();
      unDrawing();
      unPtr();
      unJoin();
      unLeave();
      unErr();
      unClosed();
      send({ type: 'WhiteboardLeave', sessionId });
    };
  }, [on, sessionId, send, pushOp, onClose, userId, redrawCanvasComposite]);

  useEffect(() => {
    if (userId) {
      setParticipants((prev) => new Set(prev).add(String(userId)));
    }
  }, [userId]);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    strokeIdRef.current = newStrokeId();
    drawingSendIndexRef.current = 0;
    lastDrawingSendRef.current = 0;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const strokeColor = tool === 'eraser' ? '#000' : color;
    drawingRef.current = {
      points: [{ x, y }],
      color: strokeColor,
      width,
      kind: 'stroke',
      tool: tool === 'eraser' ? 'eraser' : 'pen',
    };
  };

  const onPointerMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const nx = Math.min(1, Math.max(0, x));
    const ny = Math.min(1, Math.max(0, y));
    sendPointerIfDue(nx, ny);

    const d = drawingRef.current;
    if (!d) return;
    d.points.push({ x: nx, y: ny });
    maybeSendDrawingDelta();
    redrawCanvasComposite(canvas, d);
  };

  const endStroke = () => {
    flushDrawingDelta();
    const d = drawingRef.current;
    const strokeIdForOp = strokeIdRef.current;
    strokeIdRef.current = null;
    if (!d || d.points.length < 2) {
      drawingRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) redrawCanvasComposite(canvas, null);
      return;
    }
    const op = {
      kind: 'stroke',
      ...(strokeIdForOp ? { stroke_id: strokeIdForOp } : {}),
      points: d.points,
      color: d.color,
      width: d.width,
      tool: d.tool || 'pen',
    };
    drawingRef.current = null;
    send({ type: 'WhiteboardOp', sessionId, op });
    pushOp({ ...op, user_id: userId });
  };

  const handleClearBoard = () => {
    if (!isOwner) return;
    send({ type: 'WhiteboardOp', sessionId, op: { kind: 'clear_board' } });
    opsRef.current = [];
    remotePreviewsRef.current.clear();
    const canvas = canvasRef.current;
    if (canvas) redrawCanvasComposite(canvas, drawingRef.current);
  };

  const handleCloseSnapshot = async () => {
    const canvas = canvasRef.current;
    if (!canvas || closing) return;
    setClosing(true);
    setStatus('');
    try {
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not export canvas'))), 'image/png');
      });
      const file = new File([blob], 'whiteboard.png', { type: 'image/png' });
      const att = await uploadFile(file);
      await post(`/whiteboard/${sessionId}/close`, { attachment: att });
      onClose?.();
    } catch (err) {
      setStatus(err?.error || err?.message || 'Could not close session');
    } finally {
      setClosing(false);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      redrawCanvasComposite(canvas, drawingRef.current);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redrawCanvasComposite]);

  return (
    <div className="whiteboard-modal-overlay" role="dialog" aria-modal="true" aria-label="Whiteboard">
      <div className="whiteboard-modal">
        <div className="whiteboard-modal-header">
          <span className="whiteboard-modal-title">Whiteboard</span>
          {participants.size > 0 && (
            <span className="whiteboard-modal-participants" title="Users connected to this session">
              {participants.size} here
            </span>
          )}
          <div className="whiteboard-modal-actions">
            {isOwner && (
              <>
                <button type="button" className="whiteboard-btn danger" onClick={handleClearBoard} title="Clear for everyone">
                  Clear board
                </button>
                <button type="button" className="whiteboard-btn primary" onClick={handleCloseSnapshot} disabled={closing}>
                  {closing ? 'Uploading…' : 'Export & end session'}
                </button>
              </>
            )}
            <button type="button" className="whiteboard-btn" onClick={() => onClose?.()}>
              Leave
            </button>
          </div>
        </div>
        <div className="whiteboard-toolbar">
          <div className="whiteboard-tools" role="group" aria-label="Tools">
            <button
              type="button"
              className={`whiteboard-tool-btn ${tool === 'pen' ? 'active' : ''}`}
              onClick={() => setTool('pen')}
              title="Pen"
            >
              Pen
            </button>
            <button
              type="button"
              className={`whiteboard-tool-btn ${tool === 'eraser' ? 'active' : ''}`}
              onClick={() => setTool('eraser')}
              title="Eraser"
            >
              Eraser
            </button>
          </div>
          <label className="whiteboard-toolbar-label">
            Color
            <input
              type="color"
              className="whiteboard-color-input"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              disabled={tool === 'eraser'}
              title="Stroke color"
            />
          </label>
          <label className="whiteboard-toolbar-label">
            Size
            <input
              type="range"
              min={2}
              max={24}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              title="Brush size"
            />
            <span className="whiteboard-width-value">{width}</span>
          </label>
        </div>
        {status && <div className="whiteboard-modal-status">{status}</div>}
        <div className="whiteboard-canvas-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="whiteboard-canvas"
            width={800}
            height={520}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
          />
          <div className="whiteboard-cursors" aria-hidden>
            {[...cursors.entries()].map(([uid, pos]) => (
              <div
                key={uid}
                className="whiteboard-cursor-wrap"
                style={{
                  left: `${pos.x * 100}%`,
                  top: `${pos.y * 100}%`,
                }}
              >
                <span
                  className="whiteboard-cursor-label"
                  style={{ borderLeft: `3px solid ${colorForUserId(uid)}` }}
                >
                  {resolveDisplayName(uid)}
                </span>
                <div
                  className="whiteboard-cursor-dot"
                  style={{ borderColor: colorForUserId(uid) }}
                />
              </div>
            ))}
          </div>
        </div>
        <p className="whiteboard-hint">Draw with your pointer. Eraser removes ink. Owner can clear the board or export when done.</p>
      </div>
    </div>
  );
}

export default WhiteboardModal;
