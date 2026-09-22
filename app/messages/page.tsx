"use client";

import { FormEvent, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { createConversation, sendMessage, useConversationMessages, useConversations, useDepartments, useEmployees } from "@/lib/firebase/data";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, LoadingState } from "@/components/shared/states";

function relativeTime(value: unknown) {
  if (!value) return "";
  const date = typeof value === "object" && value !== null && "toDate" in value
    ? (value as { toDate: () => Date }).toDate()
    : new Date(value as string);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

export default function MessagesPage() {
  const { profile, user } = useAuth();
  const { data: conversations, loading } = useConversations(profile?.institutionId, user?.uid, profile?.role, profile?.departmentId);
  const { data: employees } = useEmployees(profile?.institutionId);
  const { data: departments } = useDepartments(profile?.institutionId);
  const [selectedId, setSelectedId] = useState<string>();
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [conversationType, setConversationType] = useState<"direct" | "department" | "institution_wide">("direct");
  const [conversationDepartment, setConversationDepartment] = useState("");
  const [notice, setNotice] = useState("");
  const selected = conversations.find((item) => item.conversationId === selectedId) ?? conversations[0];
  const messages = useConversationMessages(selected?.conversationId);
  const visible = useMemo(() => conversations.filter((item) => {
    if (!search) return true;
    const participantNames = employees.filter((person) => item.participantIds.includes(person.uid)).map((person) => person.fullName).join(" ");
    const departmentName = departments.find((department) => department.departmentId === item.departmentId)?.name ?? "";
    return `${item.title ?? ""} ${item.lastMessagePreview ?? ""} ${participantNames} ${departmentName}`.toLowerCase().includes(search.toLowerCase());
  }), [conversations, departments, employees, search]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!profile || !user || !composer.trim() || !selected) return;
    await sendMessage(selected.conversationId, { text: composer.trim(), type: "text", senderId: user.uid, institutionId: profile.institutionId });
    setComposer("");
  }
  async function startConversation(event: FormEvent) {
    event.preventDefault();
    if (!profile || !user || (conversationType === "direct" && !recipient)) return;
    const departmentId = conversationType === "department" ? (profile.role === "Manager" ? profile.departmentId : conversationDepartment) : null;
    if (conversationType === "department" && !departmentId) return;
    const id = await createConversation({ institutionId: profile.institutionId, participantIds: conversationType === "direct" ? [user.uid, recipient] : [user.uid], type: conversationType, departmentId, createdBy: user.uid });
    setRecipient(""); setConversationDepartment(""); setConversationType("direct"); setNewOpen(false); setSelectedId(id);
  }
  async function startCall() {
    setNotice("");
    const result = await fetch("/api/zoom/start-call", { method: "POST" });
    const body = await result.json() as { joinUrl?: string; error?: string };
    if (body.joinUrl && selected && profile && user) {
      await sendMessage(selected.conversationId, { text: "Zoom call", type: "call_link", callUrl: body.joinUrl, senderId: user.uid, institutionId: profile.institutionId });
      window.open(body.joinUrl, "_blank", "noopener,noreferrer");
    }
    else setNotice(body.error ?? "Unable to start call.");
  }

  return (
    <div>
      <PageHeader
        eyebrow="Information"
        title="Messages"
        description="Keep institution conversations focused, searchable, and easy to follow."
        breadcrumbs={[{ label: "Workspace", href: "/" }, { label: "Messages" }]}
      />

      <div className="flex h-[calc(100vh-14rem)] min-h-[520px] flex-col overflow-hidden rounded-lg border border-line bg-surface md:flex-row">
        <aside className="w-full border-b border-line md:w-80 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between p-4">
            <h1 className="font-semibold text-ink">Messages</h1>
            <button className="rounded bg-accent px-2 py-1 text-xs text-white" onClick={() => setNewOpen((value) => !value)}>New</button>
          </div>

          {newOpen && (
            <form className="border-y border-line p-3" onSubmit={startConversation}>
              <select className="h-9 w-full rounded border border-line bg-surface px-2 text-sm text-ink" value={conversationType} onChange={(event) => setConversationType(event.target.value as typeof conversationType)}>
                <option value="direct">Direct</option>
                {(profile?.role === "Owner" || profile?.role === "Admin" || profile?.role === "Manager") && <option value="department">Department</option>}
                {(profile?.role === "Owner" || profile?.role === "Admin" || profile?.role === "Manager") && <option value="institution_wide">Institution-wide</option>}
              </select>

              {conversationType === "direct" && (
                <select required className="mt-2 h-9 w-full rounded border border-line bg-surface px-2 text-sm text-ink" value={recipient} onChange={(event) => setRecipient(event.target.value)}>
                  <option value="">Choose colleague</option>
                  {employees.filter((item) => item.uid !== user?.uid).map((item) => (
                    <option key={item.uid} value={item.uid}>{item.fullName}</option>
                  ))}
                </select>
              )}

              {conversationType === "department" && profile?.role !== "Manager" && (
                <select required className="mt-2 h-9 w-full rounded border border-line bg-surface px-2 text-sm text-ink" value={conversationDepartment} onChange={(event) => setConversationDepartment(event.target.value)}>
                  <option value="">Choose department</option>
                  {departments.map((item) => <option key={item.departmentId} value={item.departmentId}>{item.name}</option>)}
                </select>
              )}

              <button className="mt-2 text-xs text-accent" type="submit">Start conversation</button>
            </form>
          )}

          <div className="p-3">
            <input className="h-9 w-full rounded border border-line bg-surface px-3 text-sm text-ink" placeholder="Search conversations" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>

          <div className="overflow-y-auto">
            {loading && <LoadingState label="Loading conversations…" />}
            {!loading && visible.length === 0 && (
              <div className="p-3">
                <EmptyState title="No conversations found" description="Start a conversation with a colleague to get going." />
              </div>
            )}
            {visible.map((item) => (
              <button
                key={item.conversationId}
                onClick={() => setSelectedId(item.conversationId)}
                className={`w-full border-t border-line p-4 text-left ${selected?.conversationId === item.conversationId ? "bg-accent-soft" : "hover:bg-surface-raised"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-ink">
                    {item.title || employees.find((person) => item.participantIds.includes(person.uid) && person.uid !== user?.uid)?.fullName || departments.find((department) => department.departmentId === item.departmentId)?.name || "Conversation"}
                  </p>
                  <span className="shrink-0 text-[11px] text-muted">{relativeTime(item.lastMessageAt)}</span>
                </div>
                <p className="mt-1 truncate text-xs text-muted">{item.lastMessagePreview || "No messages yet"}</p>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-line p-4">
            <div>
              <h2 className="font-semibold text-ink">{selected?.title || "Conversation"}</h2>
              <p className="text-xs text-muted">{selected ? `${selected.participantIds.length} participants` : "Select a conversation to begin"}</p>
            </div>
            {selected && (
              <button onClick={() => void startCall()} className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-raised">
                Start Call
              </button>
            )}
          </header>
          {notice && <p className="border-b border-line px-4 py-2 text-sm text-danger">{notice}</p>}
          <div className="flex-1 space-y-3 overflow-y-auto p-5">
            {!selected && <p className="text-sm text-muted">No messages yet — say hello</p>}
            {selected && messages.length === 0 && <p className="text-sm text-muted">No messages yet — say hello</p>}
            {messages.map((message) => (
              <div key={message.messageId} className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${message.senderId === user?.uid ? "ml-auto bg-accent text-white" : "bg-surface-raised text-ink"}`}>
                {message.type === "call_link" ? (
                  <a href={message.callUrl} target="_blank" rel="noreferrer" className="font-semibold underline">Join Call</a>
                ) : (
                  message.text
                )}
              </div>
            ))}
          </div>
          {selected && (
            <form onSubmit={submit} className="flex gap-2 border-t border-line p-4">
              <input required className="h-10 min-w-0 flex-1 rounded border border-line bg-surface px-3 text-sm text-ink" placeholder="Write a message…" value={composer} onChange={(event) => setComposer(event.target.value)} />
              <button className="rounded bg-accent px-4 text-sm text-white" type="submit">Send</button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
