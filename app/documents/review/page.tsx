"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useDocuments } from "@/lib/firebase/data";

export default function DocumentsReviewPage() {
  const { profile, user } = useAuth();
  const { data: docs, loading, loadingMore, error, nextCursor, loadMore, refresh } = useDocuments(profile?.institutionId, "NEEDS_REVIEW");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!profile) return <div className="p-4">Sign in to view documents.</div>;

  const review = async (id: string, action: "approve" | "reject") => {
    if (!confirm(`Are you sure you want to ${action} this document?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      if (!user) throw new Error("Sign in again before reviewing documents.");
      const idToken = await user.getIdToken();
      const response = await fetch("/api/documents/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ documentId: id, action: action }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Document review failed.");
      setMessage(`Document ${action === "approve" ? "approved" : "rejected"}.`);
      refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Document review failed.");
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold mb-4">Documents needing review</h1>
      {error && <div className="mb-3 text-sm text-danger" role="alert">{error} <button type="button" className="underline" onClick={refresh}>Retry</button></div>}
      {message && <div className="mb-3 text-sm text-muted" role="status">{message}</div>}
      {loading && <p>Loading…</p>}
      {!loading && docs.length === 0 && <p>No documents require review.</p>}
      <ul>
        {docs.map((d) => (
          <li key={d.documentId} className="mb-3 border p-3 rounded">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{d.name}</div>
                <div className="text-sm text-muted">{d.mimeType} • {d.size} bytes</div>
                <div className="text-xs text-muted">Uploaded: {d.uploadedAt ?? "time unavailable"}</div>
              </div>
              <div className="flex gap-2">
                <a href={`/api/documents/download?documentId=${encodeURIComponent(d.documentId)}`} target="_blank" rel="noreferrer" className="text-accent">Download</a>
                <button disabled={busy} onClick={() => void review(d.documentId, "approve")} className="ml-2 rounded bg-green-600 text-white px-3 py-1">Approve</button>
                <button disabled={busy} onClick={() => void review(d.documentId, "reject")} className="ml-2 rounded bg-red-600 text-white px-3 py-1">Reject</button>
              </div>
            </div>
            <div className="mt-2 text-xs text-muted">Scan: {d.scanStatus}</div>
            {d.scanReason && <div className="mt-1 text-xs text-warning">{d.scanReason}</div>}
          </li>
        ))}
      </ul>
      {nextCursor && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          className="mt-3 rounded border px-3 py-1.5 disabled:opacity-60"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
