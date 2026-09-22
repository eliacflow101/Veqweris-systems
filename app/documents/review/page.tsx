"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useDocuments } from "@/lib/firebase/data";

export default function DocumentsReviewPage() {
  const { profile } = useAuth();
  const { data: docs, loading } = useDocuments(profile?.institutionId, "NEEDS_REVIEW");
  const [busy, setBusy] = useState(false);

  if (!profile) return <div className="p-4">Sign in to view documents.</div>;

  const review = async (id: string, action: "approve" | "reject") => {
    if (!confirm(`Are you sure you want to ${action} this document?`)) return;
    setBusy(true);
    try {
      const token = await (await fetch('/api/auth/session', { method: 'GET' })).text();
      // Prefer to use the user's ID token; this is a placeholder to forward auth from client
      const idToken = await (await fetch('/api/auth/session', { method: 'POST', body: JSON.stringify({}) })).text();
    } catch (e) {
      // ignore
    }
    try {
      await fetch(`/api/documents/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: id, action: action }),
      });
      window.location.reload();
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold mb-4">Documents needing review</h1>
      {loading && <p>Loading…</p>}
      {!loading && docs.length === 0 && <p>No documents require review.</p>}
      <ul>
        {docs.map((d: any) => (
          <li key={d.documentId} className="mb-3 border p-3 rounded">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{d.name}</div>
                <div className="text-sm text-muted">{d.mimeType} • {d.size} bytes</div>
                <div className="text-xs text-muted">Uploaded by: {d.uploadedBy}</div>
              </div>
              <div className="flex gap-2">
                <a href={`/api/documents/download?path=${encodeURIComponent(d.storagePath)}`} target="_blank" rel="noreferrer" className="text-accent">Download</a>
                <button disabled={busy} onClick={() => void review(d.documentId, "approve")} className="ml-2 rounded bg-green-600 text-white px-3 py-1">Approve</button>
                <button disabled={busy} onClick={() => void review(d.documentId, "reject")} className="ml-2 rounded bg-red-600 text-white px-3 py-1">Reject</button>
              </div>
            </div>
            {d.extractedText && <pre className="mt-2 text-xs whitespace-pre-wrap">{d.extractedText}</pre>}
          </li>
        ))}
      </ul>
    </div>
  );
}
