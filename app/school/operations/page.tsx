"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/shared/section-heading";
import { EmptyState } from "@/components/shared/states";
import { useAuth } from "@/lib/auth-context";
import { canAccessSchoolArea } from "@/lib/school/operations";

const areas = [
  ["library", "Library", "Books, copies, loans, returns, overdue items and reservations."],
  ["transport", "Transport", "Vehicles, routes, drivers, pickup points and schedules."],
  ["hostel", "Hostel", "Houses, rooms, beds, occupancy and movements."],
  ["health", "Health", "Authorized clinic visits, incidents, medication and referrals."],
  ["welfare", "Welfare", "Student welfare incidents, follow-up and outcomes."],
  ["safeguarding", "Safeguarding", "Policy-configured safeguarding workflows and review."],
] as const;

export default function SchoolOperationsPage() {
  const { profile } = useAuth();
  const role = profile?.role ?? "Employee";
  return (
    <div className="space-y-6">
      <SectionHeading eyebrow="School operations" title="Operational modules" description="Shared school operations with role-scoped access and independent sensitivity controls." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {areas.map(([area, label, description]) => {
          const access = canAccessSchoolArea({ area, role, moduleEnabled: false, sensitivity: area === "health" || area === "safeguarding" ? "highly_sensitive" : "standard", hasSensitivePermission: false });
          return <Card key={area} className="p-5"><div className="flex items-center justify-between"><h2 className="font-semibold text-ink">{label}</h2><Badge>{access.allowed ? "Available" : "Setup required"}</Badge></div><p className="mt-3 text-sm text-muted">{description}</p><p className="mt-3 text-xs text-muted">{access.reason}</p></Card>;
        })}
      </div>
      <EmptyState title="Operational modules are not configured" description="Enable a module and configure its institution policy before operational records can be created. No sample records are shown." />
    </div>
  );
}
