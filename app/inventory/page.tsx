"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/shared/section-heading";
import { useAuth } from "@/lib/auth-context";
import type { InventoryItem, StockMovement, StockMovementType } from "@/lib/inventory-engine";

type ItemDraft = { name: string; sku: string; category: string; unit: string; minimumLevel: string; safetyLevel: string; locationId: string };
type MovementDraft = { type: StockMovementType; quantity: string; adjustmentDirection: "increase" | "decrease"; destinationLocationId: string; reason: string };
const emptyItem: ItemDraft = { name: "", sku: "", category: "general", unit: "", minimumLevel: "0", safetyLevel: "0", locationId: "" };
const emptyMovement: MovementDraft = { type: "Receiving", quantity: "", adjustmentDirection: "increase", destinationLocationId: "", reason: "" };

export default function InventoryPage() {
  const { profile } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [itemDraft, setItemDraft] = useState<ItemDraft>(emptyItem);
  const [movementDraft, setMovementDraft] = useState<MovementDraft>(emptyMovement);
  const [showItemForm, setShowItemForm] = useState(false);
  const [showMovementForm, setShowMovementForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadItems = async () => {
    if (!profile?.institutionId) return;
    setLoading(true);
    try {
      const response = await fetch("/api/inventory/items");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load inventory.");
      setItems(body.items || []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load inventory."); }
    finally { setLoading(false); }
  };
  const loadMovements = async (itemId: string) => {
    if (!itemId) { setMovements([]); return; }
    const response = await fetch(`/api/inventory/movements?itemId=${encodeURIComponent(itemId)}`);
    const body = await response.json();
    if (response.ok) setMovements(body.movements || []);
  };
  useEffect(() => { void loadItems(); }, [profile?.institutionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadMovements(selectedId); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useMemo(() => ["all", ...Array.from(new Set(items.map((item) => item.category))).sort()], [items]);
  const filteredItems = useMemo(() => items.filter((item) => {
    const text = `${item.name} ${item.sku} ${item.locationId}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (category === "all" || item.category === category);
  }), [items, query, category]);
  const lowStock = items.filter((item) => item.currentQuantity <= item.minimumLevel);
  const selected = items.find((item) => item.id === selectedId);

  const saveItem = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/inventory/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...itemDraft, minimumLevel: Number(itemDraft.minimumLevel), safetyLevel: Number(itemDraft.safetyLevel) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to create item.");
      setShowItemForm(false); setItemDraft(emptyItem); await loadItems();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create item."); }
    finally { setSaving(false); }
  };
  const recordMovement = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/inventory/movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        movementId: `movement-${crypto.randomUUID()}`, itemId: selected.id, type: movementDraft.type, quantity: Number(movementDraft.quantity),
        adjustmentDirection: movementDraft.adjustmentDirection, destinationLocationId: movementDraft.destinationLocationId, reason: movementDraft.reason,
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to record movement.");
      setShowMovementForm(false); setMovementDraft(emptyMovement); await loadItems(); await loadMovements(selected.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to record movement."); }
    finally { setSaving(false); }
  };

  return <div className="space-y-6">
    <SectionHeading eyebrow="Operations" title="Inventory" description="Institution-scoped stock, movements and replenishment visibility." />
    {error && <div className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">{error}</div>}
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="p-4"><div className="text-[10px] uppercase tracking-[0.12em] text-muted">Tracked items</div><div className="mt-3 text-2xl font-semibold text-ink">{items.length}</div></Card>
      <Card className="p-4"><div className="text-[10px] uppercase tracking-[0.12em] text-muted">Units in stock</div><div className="mt-3 text-2xl font-semibold text-ink">{items.reduce((sum, item) => sum + Number(item.currentQuantity || 0), 0)}</div></Card>
      <Card className="p-4"><div className="text-[10px] uppercase tracking-[0.12em] text-muted">Low stock</div><div className="mt-3 text-2xl font-semibold text-warning">{lowStock.length}</div></Card>
    </div>

    <Card className="p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Stock overview</h3><Button onClick={() => setShowItemForm((value) => !value)}>Create item</Button></div>
      {showItemForm && <form onSubmit={saveItem} className="mb-5 grid gap-3 rounded-md border border-line bg-surface-raised p-4 md:grid-cols-4">
        {([["name", "Name"], ["sku", "SKU"], ["unit", "Unit"], ["category", "Category"], ["locationId", "Location"], ["minimumLevel", "Minimum level"], ["safetyLevel", "Safety level"]] as const).map(([key, label]) => <label key={key} className="text-xs text-muted">{label}<Input required={["name", "sku", "unit", "locationId"].includes(key)} type={key.includes("Level") ? "number" : "text"} value={itemDraft[key]} onChange={(event) => setItemDraft({ ...itemDraft, [key]: event.target.value })} className="mt-1 w-full" /></label>)}
        <div className="flex items-end"><Button type="submit" disabled={saving}>Save item</Button></div>
      </form>}
      <div className="mb-4 flex flex-wrap gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, SKU or location" className="min-w-[220px] flex-1" /><select value={category} onChange={(event) => setCategory(event.target.value)} className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink">{categories.map((value) => <option key={value} value={value}>{value === "all" ? "All categories" : value}</option>)}</select></div>
      {loading ? <div className="py-8 text-sm text-muted">Loading inventory…</div> : <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-line text-muted"><th className="pb-2 pr-4">Item</th><th className="pb-2 pr-4">Category</th><th className="pb-2 pr-4">Quantity</th><th className="pb-2 pr-4">Thresholds</th><th className="pb-2 pr-4">State</th><th className="pb-2">Actions</th></tr></thead><tbody>{filteredItems.map((item) => <tr key={item.id} className="border-b border-line/60"><td className="py-3 pr-4"><button className="text-left font-medium text-ink hover:text-accent" onClick={() => setSelectedId(item.id)}>{item.name}</button><div className="text-xs text-muted">{item.sku} · {item.locationId}</div></td><td className="py-3 pr-4 text-muted">{item.category}</td><td className="py-3 pr-4 text-ink">{item.currentQuantity} {item.unit}</td><td className="py-3 pr-4 text-muted">min {item.minimumLevel} · safety {item.safetyLevel}</td><td className="py-3 pr-4"><Badge className={item.currentQuantity <= item.minimumLevel ? "border-warning/60 bg-warning/10 text-warning" : "border-success/60 bg-success/10 text-success"}>{item.currentQuantity <= item.minimumLevel ? "Low stock" : "In stock"}</Badge></td><td className="py-3"><Button className="h-8" onClick={() => { setSelectedId(item.id); setShowMovementForm(true); }}>Movement</Button></td></tr>)}</tbody></table>{!filteredItems.length && <div className="py-8 text-center text-sm text-muted">No inventory items found.</div>}</div>}
    </Card>

    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <Card className="p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Movement</h3>{selected && <Badge>{selected.name}</Badge>}</div>
        {!selected ? <div className="text-sm text-muted">Select an item to record or review movements.</div> : <form onSubmit={recordMovement} className="space-y-3">
          <label className="block text-xs text-muted">Operation<select value={movementDraft.type} onChange={(event) => setMovementDraft({ ...movementDraft, type: event.target.value as StockMovementType })} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink"><option>Receiving</option><option>Issue</option><option>Transfer</option><option>Adjustment</option><option>Return</option><option>Waste</option></select></label>
          <label className="block text-xs text-muted">Quantity<Input required min="0.01" step="any" type="number" value={movementDraft.quantity} onChange={(event) => setMovementDraft({ ...movementDraft, quantity: event.target.value })} className="mt-1 w-full" /></label>
          {movementDraft.type === "Adjustment" && <label className="block text-xs text-muted">Adjustment direction<select value={movementDraft.adjustmentDirection} onChange={(event) => setMovementDraft({ ...movementDraft, adjustmentDirection: event.target.value as MovementDraft["adjustmentDirection"] })} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink"><option value="increase">Increase</option><option value="decrease">Decrease</option></select></label>}
          {movementDraft.type === "Transfer" && <label className="block text-xs text-muted">Destination location<Input required value={movementDraft.destinationLocationId} onChange={(event) => setMovementDraft({ ...movementDraft, destinationLocationId: event.target.value })} className="mt-1 w-full" /></label>}
          <label className="block text-xs text-muted">Reason<Input value={movementDraft.reason} onChange={(event) => setMovementDraft({ ...movementDraft, reason: event.target.value })} className="mt-1 w-full" /></label>
          <Button type="submit" disabled={saving}>Record movement</Button>
        </form>}
      </Card>
      <Card className="p-4"><h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-muted">Movement history</h3>{!selected ? <div className="text-sm text-muted">Select an item to view its audit history.</div> : !movements.length ? <div className="text-sm text-muted">No movements recorded.</div> : <div className="space-y-2">{movements.map((movement) => <div key={movement.movementId} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-raised p-3 text-sm"><div><div className="font-medium text-ink">{movement.type} · {Math.abs(movement.movementQuantity)} {selected.unit}</div><div className="text-xs text-muted">{movement.reason} · {movement.timestamp ? new Date(movement.timestamp).toLocaleString() : "recent"}</div></div><div className="text-right text-xs text-muted">{movement.previousQuantity} → {movement.newQuantity}</div></div>)}</div>}</Card>
    </div>
  </div>;
}
