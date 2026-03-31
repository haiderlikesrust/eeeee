import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, del } from '../api';
import { useToast } from '../context/ToastContext';
import './OpicCloudPage.css';

function formatBytes(bytes) {
  if (bytes == null || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileTypeLabel(contentType) {
  if (!contentType) return 'File';
  if (contentType.startsWith('image/')) return 'Image';
  if (contentType.startsWith('video/')) return 'Video';
  if (contentType.startsWith('audio/')) return 'Audio';
  if (contentType === 'application/pdf') return 'PDF';
  if (contentType === 'application/zip') return 'ZIP';
  return 'File';
}

function resolveUrl(url) {
  if (!url) return '#';
  if (url.startsWith('http')) return url;
  return url.startsWith('/') ? url : `/${url}`;
}

function messageDeepLink(file) {
  if (!file?.channel_id || !file?.message_id) return null;
  const cid = String(file.channel_id);
  const mid = String(file.message_id);
  const sid = file.server_id ? String(file.server_id) : null;
  const path = sid ? `/channels/${sid}/${cid}` : `/channels/@me/${cid}`;
  return `${path}#msg-${mid}`;
}

function buildListQuery({ limit, skip, q, type, sort, from, to }) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('skip', String(skip));
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  if (sort && sort !== 'newest') params.set('sort', sort);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return params.toString();
}

export default function OpicCloudPage() {
  const toast = useToast();
  const [files, setFiles] = useState([]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [qInput, setQInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortMode, setSortMode] = useState('newest');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const refreshUsage = useCallback(async () => {
    try {
      const s = await get('/cloud/stats');
      setUsedBytes(s?.used_bytes ?? 0);
      setQuotaBytes(s?.quota_bytes ?? 0);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchPage = useCallback(
    async (skip, append) => {
      const qs = buildListQuery({
        limit: 50,
        skip,
        q: debouncedQ,
        type: typeFilter,
        sort: sortMode,
        from: dateFrom || undefined,
        to: dateTo || undefined,
      });
      const data = await get(`/cloud?${qs}`);
      const newFiles = Array.isArray(data?.files) ? data.files : [];
      setFiles((prev) => (append ? [...prev, ...newFiles] : newFiles));
      setHasMore(!!data?.has_more);
      setUsedBytes(data?.used_bytes ?? 0);
      setQuotaBytes(data?.quota_bytes ?? 0);
    },
    [debouncedQ, typeFilter, sortMode, dateFrom, dateTo],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setSelectedIds(new Set());
      try {
        await fetchPage(0, false);
      } catch (err) {
        if (!cancelled) toast.error(err?.error || 'Failed to load cloud files');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage, toast]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      await fetchPage(files.length, true);
    } catch (err) {
      toast.error(err?.error || 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, files.length, hasMore, loading, loadingMore, toast]);

  const pct = quotaBytes > 0 ? Math.min((usedBytes / quotaBytes) * 100, 100) : 0;
  const fillClass = pct > 90 ? 'critical' : pct > 70 ? 'warn' : '';
  const nearQuota = quotaBytes > 0 && pct >= 85;
  const atQuota = quotaBytes > 0 && usedBytes >= quotaBytes;

  const allOnPageSelected = useMemo(() => {
    if (files.length === 0) return false;
    return files.every((f) => selectedIds.has(f._id));
  }, [files, selectedIds]);

  const toggleSelectAllPage = () => {
    if (allOnPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        files.forEach((f) => next.delete(f._id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        files.forEach((f) => next.add(f._id));
        return next;
      });
    }
  };

  const toggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteOne = async (id) => {
    if (!window.confirm('Delete this file? It will be removed from any messages that include it, and the download will stop working.')) return;
    setDeletingId(id);
    try {
      await del(`/cloud/${id}`);
      toast.success('File removed from your cloud');
      setFiles((prev) => prev.filter((f) => f._id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await refreshUsage();
    } catch (err) {
      toast.error(err?.error || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} file(s)? They will be removed from messages and frees space in your cloud.`)) return;
    setDeletingBulk(true);
    try {
      const data = await post('/cloud/bulk-delete', { ids });
      const deleted = data?.deleted || [];
      const errors = data?.errors || [];
      if (deleted.length) toast.success(`Deleted ${deleted.length} file(s)`);
      if (errors.length) toast.error(`${errors.length} could not be deleted`);
      setSelectedIds(new Set());
      await fetchPage(0, false);
    } catch (err) {
      toast.error(err?.error || 'Bulk delete failed');
    } finally {
      setDeletingBulk(false);
    }
  };

  return (
    <div className="cloud-page">
      <div className="cloud-inner">
        <header className="cloud-header">
          <div>
            <h1>Opic Cloud</h1>
            <p>
              Files you upload in chats and DMs live here. You can search, sort, delete to free space, or jump back to the
              message when we have a link.
            </p>
          </div>
          <Link to="/channels/@me" className="cloud-back-btn">Back to App</Link>
        </header>

        {nearQuota && (
          <div className={`cloud-quota-banner ${atQuota ? 'cloud-quota-banner--block' : ''}`}>
            {atQuota ? (
              <span>
                <strong>Cloud full.</strong> Delete files below to upload again, or ask a moderator about a higher quota.
              </span>
            ) : (
              <span>
                <strong>Running low on cloud space</strong> ({formatBytes(usedBytes)} of {formatBytes(quotaBytes)}).
                Remove files you no longer need before uploads are blocked.
              </span>
            )}
          </div>
        )}

        <section className="cloud-usage-panel">
          <div className="cloud-usage-label">
            <span><strong>{formatBytes(usedBytes)}</strong> of {formatBytes(quotaBytes)} used</span>
            <span>{quotaBytes > 0 ? `${pct.toFixed(1)}%` : '—'}</span>
          </div>
          <div className="cloud-usage-track">
            <div className={`cloud-usage-fill ${fillClass}`} style={{ width: `${quotaBytes > 0 ? pct : 0}%` }} />
          </div>
        </section>

        <section className="cloud-files-panel">
          <div className="cloud-toolbar">
            <input
              type="search"
              className="cloud-toolbar-search"
              placeholder="Search by file name…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              aria-label="Search files"
            />
            <select
              className="cloud-toolbar-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter by type"
            >
              <option value="">All types</option>
              <option value="image">Images</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="document">Documents</option>
              <option value="other">Other</option>
            </select>
            <select
              className="cloud-toolbar-select"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              aria-label="Sort"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="size_desc">Largest first</option>
              <option value="size_asc">Smallest first</option>
              <option value="name">Name (A–Z)</option>
            </select>
            <label className="cloud-toolbar-date">
              <span>From</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="cloud-toolbar-date">
              <span>To</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
          </div>

          {selectedIds.size > 0 && (
            <div className="cloud-bulk-bar">
              <span>{selectedIds.size} selected</span>
              <button type="button" className="cloud-bulk-delete" onClick={handleBulkDelete} disabled={deletingBulk}>
                {deletingBulk ? 'Deleting…' : 'Delete selected'}
              </button>
              <button type="button" className="cloud-bulk-clear" onClick={() => setSelectedIds(new Set())}>
                Clear selection
              </button>
            </div>
          )}

          <h2 className="cloud-files-heading">Your files</h2>

          {loading ? (
            <p className="cloud-empty">Loading files…</p>
          ) : files.length === 0 ? (
            <div className="cloud-empty cloud-empty--rich">
              <p>No files match your filters.</p>
              {!debouncedQ && !typeFilter && !dateFrom && !dateTo ? (
                <p className="cloud-empty-hint">Upload an attachment in any channel; it will show up here automatically.</p>
              ) : (
                <button type="button" className="cloud-empty-reset" onClick={() => { setQInput(''); setTypeFilter(''); setDateFrom(''); setDateTo(''); setSortMode('newest'); }}>
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <table className="cloud-files-table">
                <thead>
                  <tr>
                    <th className="cloud-col-check">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleSelectAllPage}
                        aria-label="Select all on this page"
                      />
                    </th>
                    <th style={{ width: '38%' }}>Name</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Date</th>
                    <th className="cloud-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => {
                    const jump = messageDeepLink(f);
                    return (
                      <tr key={f._id}>
                        <td className="cloud-col-check">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(f._id)}
                            onChange={() => toggleRow(f._id)}
                            aria-label={`Select ${f.filename || f._id}`}
                          />
                        </td>
                        <td className="cloud-file-name">
                          <a
                            href={resolveUrl(f.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="cloud-file-link"
                            title={f.filename}
                          >
                            {f.filename || f._id}
                          </a>
                        </td>
                        <td>
                          <span className="cloud-file-type-badge">
                            {fileTypeLabel(f.content_type)}
                          </span>
                        </td>
                        <td className="cloud-file-size">{formatBytes(f.size)}</td>
                        <td className="cloud-file-date">
                          {f.created_at ? new Date(f.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="cloud-col-actions">
                          <div className="cloud-row-actions">
                            {jump ? (
                              <Link to={jump} className="cloud-action-link">
                                Jump to message
                              </Link>
                            ) : (
                              <span className="cloud-action-muted" title="Sent before we tracked message links">No chat link</span>
                            )}
                            <button
                              type="button"
                              className="cloud-delete-btn"
                              onClick={() => handleDeleteOne(f._id)}
                              disabled={deletingId === f._id || deletingBulk}
                            >
                              {deletingId === f._id ? '…' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {hasMore && (
                <div className="cloud-load-more">
                  <button type="button" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
