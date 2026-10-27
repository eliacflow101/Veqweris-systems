"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useDocuments } from "@/lib/firebase/data";

export default function DocumentsPage() {
  const { profile, user } = useAuth();
  const { data: docs, loading, loadingMore, error, nextCursor, loadMore, refresh } = useDocuments(profile?.institutionId);
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!profile) return <div className="p-4">Sign in to view documents.</div>;
  if (error) return <div className="p-4 text-sm text-danger" role="alert">{error} <button type="button" className="underline" onClick={refresh}>Retry</button></div>;

  const uploadFile = async () => {
    if (!file || !user) return;
    setBusy(true);
    setMessage(null);
    try {
      const authHeader = await user.getIdToken();
      const uploadForm = new FormData();
      uploadForm.set("file", file);
      uploadForm.set("module", "documents");
      if (profile.departmentId) uploadForm.set("departmentId", profile.departmentId);
      const initRes = await fetch("/api/documents/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${authHeader}` },
        body: uploadForm,
      });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(initJson.error || "Document upload failed");
      const { documentId } = initJson;
      refresh();

      const processRes = await fetch("/api/documents/process", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authHeader}` },
        body: JSON.stringify({ documentId }),
      });
      const processJson = await processRes.json();
      if (!processRes.ok) throw new Error(processJson.error || "Processing failed");
      setMessage(`Document uploaded and queued for processing: ${processJson.status}`);
      setFile(null);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Documents</h1>
        <div>
          <input className="rounded border px-2 py-1" placeholder="Search documents" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="mb-5 rounded border p-3">
        <div className="mb-2 font-medium">Upload a document</div>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button disabled={!file || busy} onClick={() => void uploadFile()} className="ml-2 rounded bg-accent px-3 py-1.5 text-white disabled:opacity-60">
          {busy ? "Uploading…" : "Upload"}
        </button>
        {message && <div className="mt-2 text-sm text-muted">{message}</div>}
      </div>

      {loading && <p>Loading…</p>}
      {!loading && docs.length === 0 && <p>No documents yet.</p>}
      <ul>
        {docs.filter((d) => d.name.toLowerCase().includes(query.toLowerCase())).map((d) => (
          <li key={d.documentId} className="mb-2 border-b py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{d.name}</div>
                <div className="text-sm text-muted">{d.mimeType} • {d.size} bytes • {d.status}</div>
              </div>
              <div className="flex gap-2">
                {d.status === "AVAILABLE" ? (
                  <a href={`/api/documents/download?documentId=${encodeURIComponent(d.documentId)}`} className="text-accent">Download</a>
                ) : (
                  <span className="text-xs uppercase tracking-wide text-muted">{d.status}</span>
                )}
              </div>
            </div>
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
