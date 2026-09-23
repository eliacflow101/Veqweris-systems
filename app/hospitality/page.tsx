"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { buildHospitalityDashboardMetrics } from "@/lib/hospitality";
import { buildRetailDashboardMetrics } from "@/lib/retail";
import {
  useHospitalityOrders, useHospitalityReservations, useHospitalityRooms, useHospitalityOutlets,
  useHousekeepingTasks, useMaintenanceTickets, useRetailCatalog, useRetailSales,
} from "@/lib/firebase/data";

export default function HospitalityPage() {
  const { profile } = useAuth();
  const institutionId = profile?.institutionId;
  const rooms = useHospitalityRooms(institutionId);
  const reservations = useHospitalityReservations(institutionId);
  const outlets = useHospitalityOutlets(institutionId);
  const orders = useHospitalityOrders(institutionId);
  const housekeeping = useHousekeepingTasks(institutionId);
  const maintenance = useMaintenanceTickets(institutionId);
  const catalog = useRetailCatalog(institutionId);
  const sales = useRetailSales(institutionId);
  const hospitality = useMemo(() => buildHospitalityDashboardMetrics({
    rooms: rooms.data, reservations: reservations.data, maintenance: maintenance.data,
    orders: orders.data,
  }), [rooms.data, reservations.data, maintenance.data, orders.data]);
  const retail = useMemo(() => buildRetailDashboardMetrics({ catalog: catalog.data, sales: sales.data }), [catalog.data, sales.data]);
  const cards = [
    ["Occupancy", `${hospitality.occupancyRate}%`], ["Available rooms", hospitality.availableRooms],
    ["Reservations", hospitality.activeReservations], ["Open orders", hospitality.openOrders],
    ["Outlets", outlets.data.filter((item) => item.active).length], ["Housekeeping", housekeeping.data.filter((item) => item.status !== "completed").length],
    ["Retail revenue", retail.revenue.toFixed(2)], ["Retail catalog", retail.catalogItems],
  ];
  return (
    <main className="space-y-6 p-6">
      <div><h1 className="text-2xl font-semibold">Hospitality & retail</h1><p className="text-sm text-muted-foreground">Rooms, outlets, reservations, orders, catalog and sales using shared inventory, billing and payments.</p></div>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => <div className="rounded-lg border bg-card p-4" key={label as string}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-4"><h2 className="font-medium">Room operations</h2><p className="text-sm text-muted-foreground">{rooms.data.length} rooms · {maintenance.data.length} maintenance tickets · {housekeeping.data.length} housekeeping tasks</p></div>
        <div className="rounded-lg border p-4"><h2 className="font-medium">Commerce</h2><p className="text-sm text-muted-foreground">{orders.data.length} outlet orders · {sales.data.length} retail sales · {retail.inventoryDeductions} shared inventory references</p></div>
      </section>
    </main>
  );
}
