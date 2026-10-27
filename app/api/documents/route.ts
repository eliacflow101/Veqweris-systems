import { FieldPath, Timestamp, type DocumentData, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { PermissionAuthorizationError, requirePermission } from "@/lib/permissions/server";
import { canReadDocument } from "@/lib/documents/access";

const pageSize = 50;
type DocumentCursor = {
  uid: string;
  institutionId: string;
  permissionVersion: number;
  documentId: string;
  statusFilter: string | null;
};

function decodeCursor(
  value: string,
  context: { uid: string; institutionId: string; permissionVersion: number; statusFilter: string | null },
): DocumentCursor {
  let cursor: unknown;
  try {
    cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_CURSOR");
  }
  if (!cursor || typeof cursor !== "object") throw new Error("INVALID_CURSOR");
  const parsed = cursor as Partial<DocumentCursor>;
  if (parsed.uid !== context.uid || parsed.institutionId !== context.institutionId
    || parsed.permissionVersion !== context.permissionVersion
    || typeof parsed.documentId !== "string" || !parsed.documentId
    || parsed.statusFilter !== context.statusFilter) throw new Error("INVALID_CURSOR");
  return parsed as DocumentCursor;
}

function encodeCursor(cursor: DocumentCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

function isoDate(value: unknown): string | null {
  const millis = timestampMillis(value);
  return millis === null ? null : new Date(millis).toISOString();
}

async function loadVisibleDocuments(
  institutionId: string,
  statusFilter: string | null,
  context: Awaited<ReturnType<typeof requirePermission>>,
  cursor: DocumentCursor | null,
) {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const visible: QueryDocumentSnapshot<DocumentData>[] = [];
  let scanned = 0;
  let lastScanned: QueryDocumentSnapshot<DocumentData> | null = null;
  let query = adminDb.collection("documents")
    .where("institutionId", "==", institutionId)
    .orderBy(FieldPath.documentId(), "asc")
    .limit(50);
  if (statusFilter) query = query.where("status", "==", statusFilter);
  if (cursor) query = query.startAfter(cursor.documentId);

  while (scanned < 500 && visible.length < pageSize + 1) {
    const snapshot = await query.get();
    if (snapshot.empty) break;
    for (const record of snapshot.docs) {
      lastScanned = record;
      scanned += 1;
      if (canReadDocument(record.data(), context)) visible.push(record);
      if (visible.length === pageSize + 1 || scanned === 500) break;
    }
    if (snapshot.size < 50 || visible.length === pageSize + 1 || scanned === 500) break;
    lastScanned = snapshot.docs.at(-1) ?? lastScanned;
    query = query.startAfter(lastScanned);
  }

  const hasMoreVisible = visible.length > pageSize;
  const page = visible.slice(0, pageSize);
  const nextAnchor = hasMoreVisible ? page.at(-1) : lastScanned;
  const nextCursor = nextAnchor && (hasMoreVisible || scanned === 500)
    ? encodeCursor({
      uid: context.uid,
      institutionId,
      permissionVersion: context.permissionVersion,
      documentId: nextAnchor.id,
      statusFilter,
    })
    : null;
  return { page, nextCursor };
}

function safeMetadata(snapshot: QueryDocumentSnapshot<DocumentData>) {
  const record = snapshot.data();
  return {
    documentId: snapshot.id,
    name: typeof record.name === "string" ? record.name : "Unnamed document",
    mimeType: typeof record.mimeType === "string" ? record.mimeType : "application/octet-stream",
    size: typeof record.size === "number" ? record.size : 0,
    status: record.status,
    scanStatus: record.scanStatus ?? "UNKNOWN",
    scanReason: typeof record.scanReason === "string" ? record.scanReason : null,
    departmentId: typeof record.departmentId === "string" ? record.departmentId : null,
    createdAt: isoDate(record.createdAt),
    uploadedAt: isoDate(record.uploadedAt),
    updatedAt: isoDate(record.updatedAt),
  };
}

function failure(error: unknown) {
  if (error instanceof PermissionAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const code = error instanceof Error ? error.message : "";
  const status = code === "SERVICE_UNAVAILABLE" ? 503
    : code === "UNAUTHENTICATED" ? 401
      : code === "FORBIDDEN" ? 403
        : code === "INVALID_CURSOR" ? 400 : 400;
  if (status === 503) console.error("Document metadata service is unavailable.", error);
  return NextResponse.json({ error: status === 401 ? "Authentication required."
    : status === 403 ? "Document metadata access is not authorized."
      : status === 503 ? "Document metadata is temporarily unavailable."
        : "Unable to load document metadata." }, { status });
}

export async function GET(request: Request) {
  try {
    const context = await requirePermission(request, "documents.read");
    if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
    const params = new URL(request.url).searchParams;
    const statusFilter = params.get("status");
    const validStatuses = new Set(["UPLOADED", "QUEUED", "PROCESSING", "EXTRACTED", "NEEDS_REVIEW", "VALIDATED", "VERIFIED", "AVAILABLE", "FAILED", "UNSUPPORTED", "REJECTED"]);
    if (statusFilter && !validStatuses.has(statusFilter)) {
      return NextResponse.json({ error: "Unsupported document status filter." }, { status: 400 });
    }
    const cursorValue = params.get("cursor");
    const parsedCursor = cursorValue
      ? decodeCursor(cursorValue, { ...context, statusFilter })
      : null;
    const { page, nextCursor } = await loadVisibleDocuments(context.institutionId, statusFilter, context, parsedCursor);
    return NextResponse.json({
      documents: page.map(safeMetadata),
      nextCursor,
      pageSize,
    });
  } catch (error) {
    return failure(error);
  }
}
