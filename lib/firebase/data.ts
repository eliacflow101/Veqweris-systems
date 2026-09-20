"use client";

import {
  collection, doc, getDocs, query, serverTimestamp, updateDoc, where,
} from "@firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./client";
import type { Department, Task, UserProfile, TaskStatus, TaskPriority } from "./models";

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

export const useDepartments = (institutionId?: string) => useCollectionData<Department>("departments", institutionId);
export const useEmployees = (institutionId?: string) => useCollectionData<UserProfile>("users", institutionId);
export const useTasks = (institutionId?: string) => useCollectionData<Task>("tasks", institutionId);

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

export async function updateEmployee(id: string, values: Partial<Pick<UserProfile, "fullName" | "role" | "departmentId" | "status">>) {
  if (db) await updateDoc(doc(db, "users", id), values);
}

export async function saveTask(input: Pick<Task, "title" | "description" | "departmentId" | "assignedTo" | "priority" | "dueDate"> & { status?: TaskStatus }, institutionId: string, assignedBy: string, taskId?: string) {
  if (!db) throw new Error("Firebase is not configured.");
  const ref = taskId ? doc(db, "tasks", taskId) : doc(collection(db, "tasks"));
  const payload = { ...input, taskId: ref.id, institutionId, assignedBy, status: input.status ?? "todo", updatedAt: serverTimestamp() };
  if (taskId) await updateDoc(ref, payload);
  else await (await import("@firebase/firestore")).setDoc(ref, { ...payload, createdAt: serverTimestamp() });
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
