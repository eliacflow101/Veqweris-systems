"use client";

import {
  collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where,
} from "@firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./client";
import type { ApprovalRecord, ApprovalStatus, Conversation, Department, Institution, Message, PlannerEvent, SecurityEvent, SecurityEventType, Task, UserProfile, TaskStatus, TaskPriority, UserPreferences } from "./models";
import type { AcademicEnrollment, AcademicLevelRecord, AcademicYear, CurriculumRecord, GuardianRecord, PlacementReview, SchoolClassRecord, SchoolProfile, StreamRecord, StudentGuardianLink, StudentRecord, SubjectRecord } from "@/lib/school";
import type { BillingReference, ClinicalRecord, HealthcareDocument, HealthcareEncounter, HealthcareQueueEntry, HealthcareResource, HealthcareService, HealthcareServicePoint, HealthcareWorkspaceProfile, LaboratoryRequest, LaboratoryResult, LaboratorySample, PatientIdentity, PharmacyBatch, PharmacyDispense, PharmacyMedicine } from "@/lib/healthcare";

export function useCollectionData<T>(path: string, institutionId?: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    if (!db || !institutionId) { setData([]); setLoading(false); return; }
    setLoading(true);
    const load = async () => {
      try {
        const snap = await getDocs(query(collection(db!, path), where("institutionId", "==", institutionId)));
        if (mounted) setData(snap.docs.map((item) => item.data() as T));
      } catch { if (mounted) setError("Unable to load workspace data."); }
      finally { if (mounted) setLoading(false); }
    };
    void load();
    return () => { mounted = false; };
  }, [path, institutionId]);
  return { data, loading, error };
}

export function useDocuments(institutionId?: string, status?: string) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    if (!db || !institutionId) { setData([]); setLoading(false); return; }
    setLoading(true);
    const load = async () => {
      try {
        const base = collection(db!, "documents");
        const q = status
          ? query(base, where("institutionId", "==", institutionId), where("status", "==", status))
          : query(base, where("institutionId", "==", institutionId));
        const snap = await getDocs(q);
        if (mounted) setData(snap.docs.map((item) => item.data()));
      } catch (e) { if (mounted) setData([]); }
      finally { if (mounted) setLoading(false); }
    };
    void load();
    return () => { mounted = false; };
  }, [institutionId, status]);
  return { data, loading };
}

export const useDepartments = (institutionId?: string) => useCollectionData<Department>("departments", institutionId);
export const useEmployees = (institutionId?: string) => useCollectionData<UserProfile>("users", institutionId);
export const useTasks = (institutionId?: string) => useCollectionData<Task>("tasks", institutionId);
export const useApprovals = (institutionId?: string) => useCollectionData<ApprovalRecord>("approvals", institutionId);
export const useSchoolProfile = (institutionId?: string) => {
  const result = useCollectionData<SchoolProfile>("schoolProfiles", institutionId);
  return { ...result, data: result.data[0] ?? null };
};
export const useAcademicYears = (institutionId?: string) => useCollectionData<AcademicYear>("academicYears", institutionId);
export const useAcademicLevels = (institutionId?: string) => useCollectionData<AcademicLevelRecord>("academicLevels", institutionId);
export const useSchoolClasses = (institutionId?: string) => useCollectionData<SchoolClassRecord>("schoolClasses", institutionId);
export const useSchoolStreams = (institutionId?: string) => useCollectionData<StreamRecord>("schoolStreams", institutionId);
export const useSchoolSubjects = (institutionId?: string) => useCollectionData<SubjectRecord>("schoolSubjects", institutionId);
export const useCurricula = (institutionId?: string) => useCollectionData<CurriculumRecord>("curricula", institutionId);
export const useStudents = (institutionId?: string) => useCollectionData<StudentRecord>("students", institutionId);
export const useEnrollments = (institutionId?: string) => useCollectionData<AcademicEnrollment>("academicEnrollments", institutionId);
export const useGuardians = (institutionId?: string) => useCollectionData<GuardianRecord>("guardians", institutionId);
export const useStudentGuardianLinks = (institutionId?: string) => useCollectionData<StudentGuardianLink>("studentGuardianLinks", institutionId);
export const usePlacementReviews = (institutionId?: string) => useCollectionData<PlacementReview>("placementReviews", institutionId);
export const useHealthcareProfile = (institutionId?: string) => {
  const result = useCollectionData<HealthcareWorkspaceProfile>("healthcareProfiles", institutionId);
  return { ...result, data: result.data[0] ?? null };
};
export const usePatientIdentities = (institutionId?: string) => useCollectionData<PatientIdentity>("patientIdentities", institutionId);
export const useHealthcareEncounters = (institutionId?: string) => useCollectionData<HealthcareEncounter>("healthcareEncounters", institutionId);
export const useHealthcareServices = (institutionId?: string) => useCollectionData<HealthcareService>("healthcareServices", institutionId);
export const useHealthcareQueueEntries = (institutionId?: string) => useCollectionData<HealthcareQueueEntry>("healthcareQueue", institutionId);
export const useHealthcareServicePoints = (institutionId?: string) => useCollectionData<HealthcareServicePoint>("healthcareServicePoints", institutionId);
export const useHealthcareResources = (institutionId?: string) => useCollectionData<HealthcareResource>("healthcareResources", institutionId);
export const useClinicalRecords = (institutionId?: string) => useCollectionData<ClinicalRecord>("clinicalRecords", institutionId);
export const useBillingReferences = (institutionId?: string) => useCollectionData<BillingReference>("billingReferences", institutionId);
export const useHealthcareDocuments = (institutionId?: string) => useCollectionData<HealthcareDocument>("healthcareDocuments", institutionId);
export const useLaboratoryRequests = (institutionId?: string) => useCollectionData<LaboratoryRequest>("laboratoryRequests", institutionId);
export const useLaboratorySamples = (institutionId?: string) => useCollectionData<LaboratorySample>("laboratorySamples", institutionId);
export const useLaboratoryResults = (institutionId?: string) => useCollectionData<LaboratoryResult>("laboratoryResults", institutionId);
export const usePharmacyMedicines = (institutionId?: string) => useCollectionData<PharmacyMedicine>("pharmacyMedicines", institutionId);
export const usePharmacyBatches = (institutionId?: string) => useCollectionData<PharmacyBatch>("pharmacyBatches", institutionId);
export const usePharmacyDispenses = (institutionId?: string) => useCollectionData<PharmacyDispense>("pharmacyDispenses", institutionId);
export const useInventoryItems = (institutionId?: string) => useCollectionData<Record<string, unknown>>("inventoryItems", institutionId);
export const useInventoryMovements = (institutionId?: string) => useCollectionData<Record<string, unknown>>("inventoryMovements", institutionId);

export async function saveSchoolRecord<T extends object & { institutionId: string }>(collectionName: string, input: T, idField: string, id?: string) {
  if (!db) throw new Error("Firebase is not configured.");
  const ref = id ? doc(db, collectionName, id) : doc(collection(db, collectionName));
  const createdAt = "createdAt" in input ? input.createdAt : undefined;
  await setDoc(ref, { ...input, [idField]: ref.id, updatedAt: serverTimestamp(), createdAt: createdAt ?? serverTimestamp() }, { merge: Boolean(id) });
  return ref.id;
}

export async function saveHealthcareRecord<T extends object & { institutionId: string }>(collectionName: string, input: T, idField: string, id?: string) {
  if (!db) throw new Error("Firebase is not configured.");
  const ref = id ? doc(db, collectionName, id) : doc(collection(db, collectionName));
  const createdAt = "createdAt" in input ? input.createdAt : undefined;
  await setDoc(ref, { ...input, [idField]: ref.id, updatedAt: serverTimestamp(), createdAt: createdAt ?? serverTimestamp() }, { merge: Boolean(id) });
  return ref.id;
}

export function useConversations(institutionId?: string, uid?: string, role?: UserProfile["role"], departmentId?: string | null) {
  const [data, setData] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!db || !institutionId || !uid) { setData([]); setLoading(false); return; }
    let mounted = true;
    const base = collection(db, "conversations");
    const queries = [
      query(base, where("institutionId", "==", institutionId), where("participantIds", "array-contains", uid)),
      query(base, where("institutionId", "==", institutionId), where("type", "==", "institution_wide")),
      ...(role !== "Employee" && departmentId ? [query(base, where("institutionId", "==", institutionId), where("type", "==", "department"), where("departmentId", "==", departmentId))] : []),
    ];
    void Promise.all(queries.map((item) => getDocs(item)))
      .then((snapshots) => { if (mounted) { const unique = new Map<string, Conversation>(); snapshots.forEach((snapshot) => snapshot.docs.forEach((item) => unique.set(item.id, item.data() as Conversation))); setData([...unique.values()]); } })
      .catch(() => { if (mounted) setData([]); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [institutionId, uid, role, departmentId]);
  return { data, loading };
}

export function useConversationMessages(conversationId?: string) {
  const [data, setData] = useState<Message[]>([]);
  useEffect(() => {
    if (!db || !conversationId) { setData([]); return; }
    return onSnapshot(query(collection(db, "conversations", conversationId, "messages"), orderBy("createdAt", "asc")), (snapshot) => setData(snapshot.docs.map((item) => item.data() as Message)), () => setData([]));
  }, [conversationId]);
  return data;
}

export async function createConversation(input: Pick<Conversation, "institutionId" | "participantIds" | "type" | "createdBy"> & Partial<Pick<Conversation, "title" | "departmentId">>) {
  if (!db) throw new Error("Firebase is not configured.");
  const ref = doc(collection(db, "conversations"));
  await setDoc(ref, { ...input, conversationId: ref.id, lastMessagePreview: "", lastMessageAt: serverTimestamp(), createdAt: serverTimestamp() });
  return ref.id;
}

export async function sendMessage(conversationId: string, input: Pick<Message, "text" | "type" | "senderId" | "institutionId"> & Pick<Partial<Message>, "callUrl">) {
  if (!db) throw new Error("Firebase is not configured.");
  const ref = doc(collection(db, "conversations", conversationId, "messages"));
  await setDoc(ref, { ...input, messageId: ref.id, conversationId, createdAt: serverTimestamp() });
  await updateDoc(doc(db, "conversations", conversationId), { lastMessagePreview: input.text.slice(0, 160), lastMessageAt: serverTimestamp() });
}

export function useInstitution(institutionId?: string) {
  const [data, setData] = useState<Institution | null>(null);
  useEffect(() => {
    let mounted = true;
    if (!db || !institutionId) { setData(null); return; }
    const firestore = db;
    void getDoc(doc(firestore, "institutions", institutionId)).then((snapshot) => {
      if (mounted && snapshot.exists()) setData(snapshot.data() as Institution);
    });
    return () => { mounted = false; };
  }, [institutionId]);
  return data;
}

export function usePlannerEvents(institutionId?: string, uid?: string, role?: UserProfile["role"]) {
  const [data, setData] = useState<PlannerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    if (!db || !institutionId || !uid || !role) { setData([]); setLoading(false); return; }
    setLoading(true);
    const firestore = db;
    const load = async () => {
      try {
        const base = collection(firestore, "plannerEvents");
        const queries = role === "Employee"
          ? [
            query(base, where("institutionId", "==", institutionId), where("departmentId", "==", null)),
            query(base, where("institutionId", "==", institutionId), where("attendees", "array-contains", uid)),
          ]
          : [query(base, where("institutionId", "==", institutionId))];
        const snapshots = await Promise.all(queries.map((item) => getDocs(item)));
        const unique = new Map<string, PlannerEvent>();
        snapshots.forEach((snapshot) => snapshot.docs.forEach((item) => unique.set(item.id, item.data() as PlannerEvent)));
        if (mounted) setData([...unique.values()]);
      } catch {
        if (mounted) setData([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
  }, [institutionId, uid, role]);
  return { data, loading };
}

export async function savePlannerEvent(input: Omit<PlannerEvent, "eventId" | "institutionId" | "createdAt" | "updatedAt">, institutionId: string, eventId?: string) {
  if (!db) throw new Error("Firebase is not configured.");
  const ref = eventId ? doc(db, "plannerEvents", eventId) : doc(collection(db, "plannerEvents"));
  const payload = { ...input, eventId: ref.id, institutionId, updatedAt: serverTimestamp() };
  if (eventId) await updateDoc(ref, payload);
  else await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
}

export async function saveDepartment(input: Pick<Department, "name" | "departmentCode" | "description" | "headUserId">, institutionId: string, departmentId?: string) {
  if (!db) throw new Error("Firebase is not configured.");
  const ref = departmentId ? doc(db, "departments", departmentId) : doc(collection(db, "departments"));
  const payload = { ...input, departmentId: ref.id, institutionId, updatedAt: serverTimestamp() };
  if (departmentId) await updateDoc(ref, payload);
  else await (await import("@firebase/firestore")).setDoc(ref, { ...payload, status: "active" as const, createdAt: serverTimestamp() });
}

export async function deactivateDepartment(id: string) {
  if (db) await updateDoc(doc(db, "departments", id), { status: "inactive", updatedAt: serverTimestamp() });
}

export async function updateEmployee(id: string, values: Partial<Pick<UserProfile, "fullName" | "role" | "departmentId" | "status" | "phone" | "photoUrl" | "email">>) {
  if (db) await updateDoc(doc(db, "users", id), values);
}

export async function saveUserPreferences(userId: string, values: UserPreferences) {
  if (!db) throw new Error("Firebase is not configured.");
  await setDoc(doc(db, "users", userId), { preferences: values, lastActive: serverTimestamp() }, { merge: true });
}

export async function logSecurityEvent(input: Pick<SecurityEvent, "institutionId" | "type" | "source"> & Partial<Pick<SecurityEvent, "uid" | "details">>) {
  if (!db) return;
  const ref = doc(collection(db, "securityEvents"));
  await setDoc(ref, {
    eventId: ref.id,
    institutionId: input.institutionId,
    uid: input.uid ?? null,
    type: input.type,
    source: input.source,
    details: input.details ?? {},
    createdAt: serverTimestamp(),
  });
}

export function useSecurityEvents(institutionId?: string) {
  const [data, setData] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    if (!db || !institutionId) { setData([]); setLoading(false); return; }
    void getDocs(query(collection(db, "securityEvents"), where("institutionId", "==", institutionId))).then((snapshot) => {
      if (!active) return;
      const next = snapshot.docs.map((item) => item.data() as SecurityEvent);
      setData(next);
      setLoading(false);
    }).catch(() => { if (active) { setData([]); setLoading(false); } });
    return () => { active = false; };
  }, [institutionId]);
  return { data, loading };
}

export async function saveTask(input: Pick<Task, "title" | "description" | "departmentId" | "assignedTo" | "priority" | "dueDate"> & { status?: TaskStatus }, institutionId: string, assignedBy: string, taskId?: string) {
  if (!db) throw new Error("Firebase is not configured.");
  const ref = taskId ? doc(db, "tasks", taskId) : doc(collection(db, "tasks"));
  const payload = { ...input, taskId: ref.id, institutionId, assignedBy, status: input.status ?? "todo", updatedAt: serverTimestamp() };
  if (taskId) await updateDoc(ref, payload);
  else await (await import("@firebase/firestore")).setDoc(ref, { ...payload, createdAt: serverTimestamp() });
}

export async function saveApproval(input: Omit<ApprovalRecord, "approvalId" | "createdAt" | "updatedAt"> & Partial<Pick<ApprovalRecord, "approvalId" | "createdAt" | "updatedAt">>, approvalId?: string) {
  if (!db) throw new Error("Firebase is not configured.");
  const ref = approvalId ? doc(db, "approvals", approvalId) : doc(collection(db, "approvals"));
  const payload = { ...input, approvalId: ref.id, createdAt: input.createdAt ?? serverTimestamp(), updatedAt: serverTimestamp() };
  if (approvalId) await updateDoc(ref, payload);
  else await (await import("@firebase/firestore")).setDoc(ref, payload);
  return ref.id;
}

export async function updateApprovalStatus(approvalId: string, status: ApprovalStatus, actorUid: string, options?: { reason?: string; comments?: string; evidence?: string[]; approvalAuthority?: string; createTask?: boolean; task?: { title: string; description: string; departmentId: string | null; assignedTo: string; priority: "low" | "medium" | "high"; dueInDays?: number; } }) {
  if (!db) throw new Error("Firebase is not configured.");
  const ref = doc(db, "approvals", approvalId);
  const current = await (await import("@firebase/firestore")).getDoc(ref);
  const prior = (current.data() as ApprovalRecord | undefined)?.status ?? "Draft";
  const auditTrail = [
    ...((current.data() as ApprovalRecord | undefined)?.auditTrail ?? []),
    {
      eventId: `audit-${Date.now()}`,
      actorUid,
      actorRole: "system",
      previousStatus: prior,
      newStatus: status,
      action: status,
      reason: options?.reason,
      comments: options?.comments,
      evidence: options?.evidence ?? [],
      createdAt: serverTimestamp(),
    },
  ];
  await updateDoc(ref, { status, previousStatus: prior, updatedAt: serverTimestamp(), auditTrail, approvalAuthority: options?.approvalAuthority ?? "Owner" });

  if (options?.createTask && options.task) {
    await saveTask({
      title: options.task.title,
      description: options.task.description,
      departmentId: options.task.departmentId ?? "shared",
      assignedTo: options.task.assignedTo,
      priority: options.task.priority,
      dueDate: new Date(Date.now() + (options.task.dueInDays ?? 3) * 86400000).toISOString(),
      status: "todo",
    }, (current.data() as ApprovalRecord | undefined)?.institutionId ?? "unknown-institution", actorUid);
  }
}

export async function updateTaskStatus(id: string, status: TaskStatus) {
  if (db) await updateDoc(doc(db, "tasks", id), { status });
}

export function displayDate(value: unknown) {
  if (!value) return "—";
  const date = typeof value === "object" && value !== null && "toDate" in value
    ? (value as { toDate: () => Date }).toDate() : new Date(value as string);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function isOnline(value: unknown) {
  if (!value) return false;
  const date = typeof value === "object" && value !== null && "toDate" in value
    ? (value as { toDate: () => Date }).toDate() : new Date(value as string);
  return Date.now() - date.getTime() < 5 * 60 * 1000;
}
