"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/states";
import { SectionHeading } from "@/components/shared/section-heading";
import { useAuth } from "@/lib/auth-context";
import {
  saveHealthcareRecord,
  useBillingReferences,
  useClinicalRecords,
  useHealthcareDocuments,
  useHealthcareEncounters,
  useHealthcareProfile,
  useHealthcareQueueEntries,
  useHealthcareResources,
  useHealthcareServicePoints,
  useHealthcareServices,
  usePatientIdentities,
  useLaboratoryRequests,
  usePharmacyMedicines,
  usePharmacyBatches,
  usePharmacyDispenses,
  useInventoryItems,
} from "@/lib/firebase/data";
import { buildHealthcareDashboardMetrics, calculateHealthcareReadiness, generateHealthcarePatientNumber } from "@/lib/healthcare";

export default function HealthcarePage() {
  const { profile } = useAuth();
  const institutionId = profile?.institutionId;
  const healthcare = useHealthcareProfile(institutionId);
  const patients = usePatientIdentities(institutionId);
  const encounters = useHealthcareEncounters(institutionId);
  const services = useHealthcareServices(institutionId);
  const queue = useHealthcareQueueEntries(institutionId);
  const servicePoints = useHealthcareServicePoints(institutionId);
  const resources = useHealthcareResources(institutionId);
  const clinical = useClinicalRecords(institutionId);
  const billing = useBillingReferences(institutionId);
  const documents = useHealthcareDocuments(institutionId);
  const laboratoryRequests = useLaboratoryRequests(institutionId);
  const pharmacyMedicines = usePharmacyMedicines(institutionId);
  const pharmacyBatches = usePharmacyBatches(institutionId);
  const pharmacyDispenses = usePharmacyDispenses(institutionId);
  const inventoryItems = useInventoryItems(institutionId);
  const readiness = calculateHealthcareReadiness({
    institutionConfigured: Boolean(institutionId),
    profileConfigured: Boolean(healthcare.data?.configured),
    patientIdentityConfigured: patients.data.length > 0,
    encountersConfigured: encounters.data.length > 0,
    servicesConfigured: services.data.length > 0,
    clinicalAccessConfigured: Boolean(clinical.data.length),
    billingIntegrationConfigured: Boolean(billing.data.length),
    documentsConfigured: Boolean(documents.data.length),
  });
  const metrics = useMemo(() => buildHealthcareDashboardMetrics({
    patients: patients.data,
    encounters: encounters.data,
    services: services.data,
    queueEntries: queue.data,
    billing: billing.data,
    clinicalRecords: clinical.data,
    resources: resources.data,
  }), [patients.data, encounters.data, services.data, queue.data, billing.data, clinical.data, resources.data]);
  const counts = [
    ["Patient identity", patients.data.length],
    ["Encounters", encounters.data.length],
    ["Services", services.data.length],
    ["Queue entries", queue.data.length],
    ["Clinical records", clinical.data.length],
    ["Billing references", billing.data.length],
    ["Documents", documents.data.length],
    ["Lab requests", laboratoryRequests.data.length],
    ["Pharmacy dispenses", pharmacyDispenses.data.length],
  ];
  const [patientForm, setPatientForm] = useState({ fullName: "", phone: "", dateOfBirth: "", sex: "" });
  const [encounterForm, setEncounterForm] = useState({ patientId: "", departmentId: "", encounterType: "outpatient", status: "open" });
  const [queueForm, setQueueForm] = useState({ patientId: "", servicePointId: "", serviceId: "", priority: "routine" });
  const [labForm, setLabForm] = useState({ patientId: "", serviceId: "", sensitivity: "standard" });
  const [dispenseForm, setDispenseForm] = useState({ patientId: "", medicineId: "", batchId: "", quantity: "1" });
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function registerPatient() {
    if (!institutionId || !patientForm.fullName.trim()) return;
    setSaving(true); setMessage(null);
    try {
      const patientNumber = generateHealthcarePatientNumber(institutionId, patients.data.length + 1);
      const patientId = await saveHealthcareRecord("patientIdentities", {
        institutionId,
        patientNumber,
        patientId: "",
        fullName: patientForm.fullName.trim(),
        phone: patientForm.phone.trim() || null,
        dateOfBirth: patientForm.dateOfBirth || null,
        sex: patientForm.sex || null,
        status: "active",
        createdAt: new Date().toISOString(),
      }, "patientId");
      setEncounterForm((current) => ({ ...current, patientId }));
      setQueueForm((current) => ({ ...current, patientId }));
      setPatientForm({ fullName: "", phone: "", dateOfBirth: "", sex: "" });
      setMessage(`Patient ${patientNumber} was registered.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to register patient.");
    } finally {
      setSaving(false);
    }
  }

  async function createEncounter() {
    if (!institutionId || !encounterForm.patientId) return;
    setSaving(true); setMessage(null);
    try {
      await saveHealthcareRecord("healthcareEncounters", {
        institutionId,
        encounterId: "",
        patientId: encounterForm.patientId,
        encounterType: encounterForm.encounterType,
        status: encounterForm.status,
        departmentId: encounterForm.departmentId || null,
        practitionerId: null,
        startedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }, "encounterId");
      setMessage("Encounter created and queued for service intake.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create encounter.");
    } finally {
      setSaving(false);
    }
  }

  async function createQueueEntry() {
    if (!institutionId || !queueForm.patientId) return;
    setSaving(true); setMessage(null);
    try {
      await saveHealthcareRecord("healthcareQueue", {
        institutionId,
        queueEntryId: "",
        patientId: queueForm.patientId,
        encounterId: null,
        departmentId: null,
        servicePointId: queueForm.servicePointId || null,
        serviceId: queueForm.serviceId || null,
        status: "waiting",
        priority: queueForm.priority,
        createdAt: new Date().toISOString(),
      }, "queueEntryId");
      setMessage("Patient queued for care.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to queue patient.");
    } finally {
      setSaving(false);
    }
  }

  async function createLaboratoryRequest() {
      if (!institutionId || !labForm.patientId || !profile?.uid) return;
      setSaving(true); setMessage(null);
      try {
        await saveHealthcareRecord("laboratoryRequests", {
          institutionId, laboratoryRequestId: "", patientId: labForm.patientId,
          encounterId: null, serviceId: labForm.serviceId || null, requestedBy: profile.uid,
          status: "requested", sensitivity: labForm.sensitivity, createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }, "laboratoryRequestId");
        setMessage("Laboratory request created for the existing lab workflow.");
        setLabForm({ patientId: "", serviceId: "", sensitivity: "standard" });
      } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create laboratory request."); }
      finally { setSaving(false); }
    }

  async function createPharmacyDispense() {
      if (!institutionId || !dispenseForm.patientId || !dispenseForm.medicineId || !dispenseForm.batchId || !profile?.uid) return;
      const batch = pharmacyBatches.data.find((item) => item.batchId === dispenseForm.batchId);
      if (!batch) return;
      setSaving(true); setMessage(null);
      try {
        await saveHealthcareRecord("pharmacyDispenses", {
          institutionId, dispenseId: "", patientId: dispenseForm.patientId,
          medicineId: dispenseForm.medicineId, batchId: dispenseForm.batchId,
          inventoryMovementId: null, prescriptionReference: null,
          quantity: Math.max(1, Number(dispenseForm.quantity) || 1), dispensedBy: profile.uid,
          sensitivity: "standard",
          status: "requested", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }, "dispenseId");
        setMessage("Pharmacy dispense request created; stock remains in the shared inventory system.");
        setDispenseForm({ patientId: "", medicineId: "", batchId: "", quantity: "1" });
      } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create pharmacy request."); }
      finally { setSaving(false); }
  }

  const servicePointOptions = servicePoints.data.length ? servicePoints.data : [{ servicePointId: "triage", name: "Triage desk", departmentId: null, queueMode: "single", active: true, createdAt: new Date().toISOString() }];
  const resourceSummary = resources.data.length ? `${metrics.readyResources}/${metrics.totalResources} resources available` : "No resource inventory configured";

  return (
    <div className="space-y-6">
      <SectionHeading eyebrow="Healthcare vertical · Stage 15" title="Healthcare workspace" description="Patient registration, encounter intake, queue flow, and resource monitoring remain institution-scoped and separate from the universal payment, document, inventory, and workflow engines." />
      {message && <Card className="p-4 text-sm text-muted">{message}</Card>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted">Foundation status</p>
          <h3 className="mt-2 text-lg font-semibold text-ink">{healthcare.data?.name || "Healthcare profile not configured"}</h3>
          <p className="mt-2 text-sm text-muted">Separate identity, encounter, queue, clinical, financial, and document records prevent accidental cross-linking while preserving the core VEQWERIS engines.</p>
          <Badge className="mt-4">{readiness.ready ? "Ready for operations" : "Setup required"}</Badge>
        </Card>
        <Card className="p-5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted">Readiness</p>
          <p className="mt-3 text-2xl font-semibold text-ink">{readiness.completed}/{readiness.total}</p>
          <p className="mt-2 text-xs text-muted">{readiness.missing.slice(0, 3).join(", ") || "All checks complete"}</p>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Active patients", metrics.activePatients],
          ["Open encounters", metrics.openEncounters],
          ["Waiting queue", metrics.waitingQueue],
          ["Paid billing", metrics.paidBilling],
        ].map(([label, value]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Patient registration</h3>
          <div className="mt-4 space-y-3">
            <Input placeholder="Full legal name" value={patientForm.fullName} onChange={(event) => setPatientForm({ ...patientForm, fullName: event.target.value })} />
            <div className="grid gap-3 md:grid-cols-2">
              <Input type="date" value={patientForm.dateOfBirth} onChange={(event) => setPatientForm({ ...patientForm, dateOfBirth: event.target.value })} />
              <Input placeholder="Sex" value={patientForm.sex} onChange={(event) => setPatientForm({ ...patientForm, sex: event.target.value })} />
            </div>
            <Input placeholder="Phone number" value={patientForm.phone} onChange={(event) => setPatientForm({ ...patientForm, phone: event.target.value })} />
            <Button onClick={registerPatient} disabled={saving || !institutionId}>Register patient</Button>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Encounter intake</h3>
          <div className="mt-4 space-y-3">
            <select value={encounterForm.patientId} onChange={(event) => setEncounterForm({ ...encounterForm, patientId: event.target.value })} className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink">
              <option value="">Select patient</option>
              {patients.data.map((patient) => <option key={patient.patientId} value={patient.patientId}>{patient.fullName} ({patient.patientNumber})</option>)}
            </select>
            <select value={encounterForm.encounterType} onChange={(event) => setEncounterForm({ ...encounterForm, encounterType: event.target.value as typeof encounterForm.encounterType })} className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink">
              <option value="outpatient">Outpatient</option>
              <option value="inpatient">Inpatient</option>
              <option value="emergency">Emergency</option>
              <option value="telehealth">Telehealth</option>
              <option value="follow_up">Follow up</option>
            </select>
            <Input placeholder="Department ID (optional)" value={encounterForm.departmentId} onChange={(event) => setEncounterForm({ ...encounterForm, departmentId: event.target.value })} />
            <Button onClick={createEncounter} disabled={saving || !encounterForm.patientId}>Create encounter</Button>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Queue / service point</h3>
          <div className="mt-4 space-y-3">
            <select value={queueForm.patientId} onChange={(event) => setQueueForm({ ...queueForm, patientId: event.target.value })} className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink">
              <option value="">Select patient</option>
              {patients.data.map((patient) => <option key={patient.patientId} value={patient.patientId}>{patient.fullName}</option>)}
            </select>
            <select value={queueForm.servicePointId} onChange={(event) => setQueueForm({ ...queueForm, servicePointId: event.target.value })} className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink">
              <option value="">Select service point</option>
              {servicePointOptions.map((item) => <option key={item.servicePointId} value={item.servicePointId}>{item.name}</option>)}
            </select>
            <select value={queueForm.priority} onChange={(event) => setQueueForm({ ...queueForm, priority: event.target.value as typeof queueForm.priority })} className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink">
              <option value="routine">Routine</option>
              <option value="priority">Priority</option>
              <option value="urgent">Urgent</option>
            </select>
            <Button onClick={createQueueEntry} disabled={saving || !queueForm.patientId}>Queue patient</Button>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Resource readiness</h3>
          <div className="mt-4 space-y-3">
            <p className="text-2xl font-semibold text-ink">{metrics.utilization}%</p>
            <p className="text-sm text-muted">{resourceSummary}</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted/20">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${metrics.utilization}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm text-muted">
              <div className="rounded-md border border-line bg-surface-raised p-3"><p className="text-[10px] uppercase tracking-[0.1em]">Ready</p><p className="mt-1 text-xl font-semibold text-ink">{metrics.readyResources}</p></div>
              <div className="rounded-md border border-line bg-surface-raised p-3"><p className="text-[10px] uppercase tracking-[0.1em]">Total</p><p className="mt-1 text-xl font-semibold text-ink">{metrics.totalResources || 0}</p></div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Healthcare record families</h3>
        <div className="mt-4 grid gap-2 md:grid-cols-3">{counts.map(([label, value]) => <div key={String(label)} className="rounded-md border border-line bg-surface-raised p-3"><p className="text-xs text-muted">{label}</p><p className="mt-1 text-xl font-semibold text-ink">{value}</p></div>)}</div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Laboratory request</h3>
          <p className="mt-2 text-xs text-muted">{laboratoryRequests.data.length} requests · lifecycle and results remain in the laboratory collections.</p>
          <div className="mt-4 space-y-3">
            <select value={labForm.patientId} onChange={(event) => setLabForm({ ...labForm, patientId: event.target.value })} className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"><option value="">Select patient</option>{patients.data.map((patient) => <option key={patient.patientId} value={patient.patientId}>{patient.fullName}</option>)}</select>
            <select value={labForm.serviceId} onChange={(event) => setLabForm({ ...labForm, serviceId: event.target.value })} className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"><option value="">Select service</option>{services.data.map((service) => <option key={service.serviceId} value={service.serviceId}>{service.name}</option>)}</select>
            <select value={labForm.sensitivity} onChange={(event) => setLabForm({ ...labForm, sensitivity: event.target.value })} className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"><option value="standard">Standard</option><option value="sensitive">Sensitive</option><option value="highly_sensitive">Highly sensitive</option></select>
            <Button onClick={createLaboratoryRequest} disabled={saving || !labForm.patientId}>Create lab request</Button>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Pharmacy dispense</h3>
          <p className="mt-2 text-xs text-muted">{pharmacyDispenses.data.length} dispense requests · {inventoryItems.data.length} shared inventory items, no duplicate stock ledger.</p>
          <div className="mt-4 space-y-3">
            <select value={dispenseForm.patientId} onChange={(event) => setDispenseForm({ ...dispenseForm, patientId: event.target.value })} className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"><option value="">Select patient</option>{patients.data.map((patient) => <option key={patient.patientId} value={patient.patientId}>{patient.fullName}</option>)}</select>
            <select value={dispenseForm.medicineId} onChange={(event) => setDispenseForm({ ...dispenseForm, medicineId: event.target.value, batchId: "" })} className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"><option value="">Select medicine</option>{pharmacyMedicines.data.map((medicine) => <option key={medicine.medicineId} value={medicine.medicineId}>{medicine.name} {medicine.strength}</option>)}</select>
            <select value={dispenseForm.batchId} onChange={(event) => setDispenseForm({ ...dispenseForm, batchId: event.target.value })} className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"><option value="">Select batch</option>{pharmacyBatches.data.filter((batch) => !dispenseForm.medicineId || batch.medicineId === dispenseForm.medicineId).map((batch) => <option key={batch.batchId} value={batch.batchId}>{batch.batchNumber} · {batch.expiryDate}</option>)}</select>
            <div className="flex gap-3"><Input type="number" min="1" value={dispenseForm.quantity} onChange={(event) => setDispenseForm({ ...dispenseForm, quantity: event.target.value })} /><Button onClick={createPharmacyDispense} disabled={saving || !dispenseForm.patientId || !dispenseForm.batchId}>Request dispense</Button></div>
          </div>
        </Card>
      </div>
      {!readiness.ready && <EmptyState title="Complete healthcare setup before daily work" description={`No records are created by this dashboard. Configure: ${readiness.missing.join(", ")}.`} />}
    </div>
  );
}
