"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { PlatformCapability, PlatformRole } from "./models";

export type PlatformOperatorSession = {
  operator: { uid: string; email: string; platformRole: PlatformRole; status: string; grantedAt?: string } | null;
  capabilities: PlatformCapability[];
  activeSupportInstitutionIds: string[];
};

const emptySession: PlatformOperatorSession = { operator: null, capabilities: [], activeSupportInstitutionIds: [] };

/**
 * Resolves whether the signed-in account is a platform operator.
 *
 * The answer is always produced by the server: institution roles such as Owner or
 * Admin can never satisfy this check, and a failed probe is treated as "not an
 * operator" rather than granting access.
 */
export function usePlatformOperator() {
  const { user, loading: authLoading } = useAuth();
  const [session, setSession] = useState<PlatformOperatorSession>(emptySession);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/session", { cache: "no-store" });
      const payload = (await response.json()) as PlatformOperatorSession;
      setSession(payload?.operator ? payload : emptySession);
    } catch {
      setSession(emptySession);
      setError("Unable to verify platform operator status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setSession(emptySession); setLoading(false); return; }
    void load();
  }, [authLoading, load, user]);

  const capabilities = session.capabilities;
  return {
    operator: session.operator,
    capabilities,
    activeSupportInstitutionIds: session.activeSupportInstitutionIds,
    isPlatformOperator: Boolean(session.operator),
    loading: authLoading || loading,
    error,
    reload: load,
    can: (capability: PlatformCapability) => capabilities.includes(capability),
  };
}