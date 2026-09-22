"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/shared/section-heading";
import { createInventoryScenario, getInventoryAlerts, reconcileExpectedVsActual, type InventoryItem, type ResourceRecord } from "@/lib/inventory-engine";

const inventorySeed: InventoryItem[] = [
  createInventoryScenario("Supermarket milk", "institution-a", 42, 18, 12, "litres", "retail"),
  createInventoryScenario("School stationery pack", "institution-a", 9, 18, 12, "packs", "education"),
  createInventoryScenario("Hotel ingredient mix", "institution-a", 13, 16, 11, "kg", "hospitality"),
  createInventoryScenario("Hospital supply pack", "institution-a", 0, 14, 10, "boxes", "healthcare"),
];

const resources: ResourceRecord[] = [
  { id: "room-01", institutionId: "institution-a", name: "Prep room A", type: "room", locationId: "loc-east", capacity: 12, occupied: 8, status: "Verified Ready" },
  { id: "truck-02", institutionId: "institution-a", name: "Service vehicle", type: "vehicle", locationId: "loc-west", capacity: 4, occupied: 5, status: "Known but Unverified", restricted: true },
  { id: "eq-10", institutionId: "institution-a", name: "Sterilization unit", type: "equipment", locationId: "loc-central", capacity: 2, occupied: 1, status: "Maintenance Due", maintenanceDueAt: new Date(Date.now() - 86400000).toISOString() },
];

export default function InventoryPage() {
  const totals = useMemo(() => {
    const totalStock = inventorySeed.reduce((sum, item) => sum + item.currentQuantity, 0);
    const critical = inventorySeed.filter((item) => item.currentQuantity <= item.safetyLevel).length;
    const alerts = inventorySeed.flatMap((item) => getInventoryAlerts(item).map((alert) => ({ ...alert, item: item.name })));
    return { totalStock, critical, alerts };
  }, []);

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Operations"
        title="Inventory"
        description="A single inventory engine across retail, education, hospitality and healthcare scenarios."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Total tracked stock</div>
          <div className="mt-3 text-2xl font-semibold text-ink">{totals.totalStock}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Critical stock items</div>
          <div className="mt-3 text-2xl font-semibold text-ink">{totals.critical}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Active inventory alerts</div>
          <div className="mt-3 text-2xl font-semibold text-ink">{totals.alerts.length}</div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <Card className="p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Stock overview</h3>
            <Badge className="border-line/80 bg-surface-raised text-muted">Institution scoped</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="pb-2 pr-4">Item</th>
                  <th className="pb-2 pr-4">Category</th>
                  <th className="pb-2 pr-4">Qty</th>
                  <th className="pb-2 pr-4">Min</th>
                  <th className="pb-2 pr-4">Safety</th>
                  <th className="pb-2 pr-4">State</th>
                </tr>
              </thead>
              <tbody>
                {inventorySeed.map((item) => (
                  <tr key={item.id} className="border-b border-line/60 align-top">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-ink">{item.name}</div>
                      <div className="text-xs text-muted">{item.sku}</div>
                    </td>
                    <td className="py-3 pr-4 text-muted">{item.category}</td>
                    <td className="py-3 pr-4 text-ink">{item.currentQuantity} {item.unit}</td>
                    <td className="py-3 pr-4 text-muted">{item.minimumLevel}</td>
                    <td className="py-3 pr-4 text-muted">{item.safetyLevel}</td>
                    <td className="py-3 pr-4"><Badge className={item.currentQuantity <= item.safetyLevel ? "border-warning/60 bg-warning/10 text-warning" : "border-success/60 bg-success/10 text-success"}>{item.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-muted">Alerts</div>
          <div className="space-y-3">
            {totals.alerts.length === 0 ? <div className="text-sm text-muted">No inventory alerts.</div> : totals.alerts.map((alert, index) => (
              <div key={`${alert.item}-${index}`} className="rounded-md border border-line bg-surface-raised p-3 text-sm text-muted">
                <div className="font-medium text-ink">{alert.item}</div>
                <div className="mt-1">{alert.message}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <div className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-muted">Procurement and reservation flow</div>
          <div className="space-y-3 text-sm text-muted">
            <div className="rounded-md border border-line bg-surface-raised p-3">Request → Approval → Supplier → Purchase → Receiving → Inventory → Payment → Reconciliation</div>
            <div className="rounded-md border border-line bg-surface-raised p-3">Required → Requested → Confirmed → Reserved → Consumed / Released</div>
            <div className="rounded-md border border-line bg-surface-raised p-3">Source Event → Expected Movement → Actual Movement → Reconciliation → Exception → Human Verification → Audit → Analytics</div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-muted">Resource notices</div>
          <div className="space-y-3 text-sm text-muted">
            {resources.map((resource) => (
              <div key={resource.id} className="rounded-md border border-line bg-surface-raised p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">{resource.name}</span>
                  <Badge className={resource.status === "Verified Ready" ? "border-success/60 bg-success/10 text-success" : resource.status === "Maintenance Due" ? "border-warning/60 bg-warning/10 text-warning" : "border-muted/60 bg-muted/10 text-muted"}>{resource.status}</Badge>
                </div>
                <div className="mt-2">{resource.type} · {resource.capacity} capacity · {resource.occupied} occupied</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-muted">Deterministic reconciliation example</div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { label: "Supermarket variance", result: reconcileExpectedVsActual(40, 42, 1) },
            { label: "School variance", result: reconcileExpectedVsActual(18, 9, 0) },
            { label: "Hospital variance", result: reconcileExpectedVsActual(14, 0, 0) },
          ].map((example) => (
            <div key={example.label} className="rounded-md border border-line bg-surface-raised p-3">
              <div className="text-[10px] uppercase tracking-[0.12em] text-muted">{example.label}</div>
              <div className="mt-2 text-sm font-medium text-ink">{example.result.status}</div>
              <div className="mt-1 text-xs text-muted">Variance: {example.result.variance}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
