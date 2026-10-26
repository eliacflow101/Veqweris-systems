import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { institutionHasFeatureEntitlement } from "@/lib/platform/tenant-entitlements";
import { PermissionAuthorizationError, requirePermission } from "@/lib/permissions/server";
import { SETTING_REGISTRY, validateSettingsSection } from "@/lib/settings/registry";

const SETTINGS_SECTIONS = ["profile", "notifications", "security", "locale"] as const;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function authorizationFailure(reason: unknown) {
  if (reason instanceof PermissionAuthorizationError) {
    return NextResponse.json({ error: reason.message }, { status: reason.status });
  }
  console.error("Unable to process institution settings.", reason);
  return NextResponse.json({ error: "Unable to process institution settings." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const context = await requirePermission(request, "organization.roles.manage");
    if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const snapshots = await Promise.all(SETTINGS_SECTIONS.map((sectionId) =>
      adminDb!.collection("institutionSettings").doc(context.institutionId).collection("sections").doc(sectionId).get()));
    const sections = Object.fromEntries(SETTINGS_SECTIONS.map((sectionId, index) => [
      sectionId,
      snapshots[index].exists ? snapshots[index].data() : { institutionId: context.institutionId, sectionId, values: {}, schemaVersion: 1 },
    ]));
    const whiteLabelFooter = await institutionHasFeatureEntitlement(context.institutionId, "white-label-footer");
    return NextResponse.json({
      sections,
      registry: SETTING_REGISTRY,
      capabilities: { whiteLabelFooter },
    });
  } catch (reason) {
    return authorizationFailure(reason);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission(request, "organization.roles.manage");
    if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.sectionId !== "string" || !SETTINGS_SECTIONS.includes(body.sectionId as typeof SETTINGS_SECTIONS[number])
      || typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 500
      || typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 16 || body.idempotencyKey.length > 128
      || (body.action !== "save" && body.action !== "draft" && body.action !== "publish")) {
      return NextResponse.json({ error: "A valid section, action, reason, and idempotency key are required." }, { status: 400 });
    }

    const sectionId = body.sectionId;
    const reasonText = body.reason.trim();
    const sectionRef = adminDb.collection("institutionSettings").doc(context.institutionId)
      .collection("sections").doc(sectionId);
    const isPublish = body.action === "publish";
    const isDraft = body.action === "draft";
    const values = isPublish ? undefined : validateSettingsSection(sectionId, body.values);
    if (!isPublish && Object.keys(values ?? {}).length === 0) {
      return NextResponse.json({ error: "Provide at least one setting to change." }, { status: 400 });
    }
    if (values?.["profile.whiteLabelFooter"] === true
      && !await institutionHasFeatureEntitlement(context.institutionId, "white-label-footer")) {
      return NextResponse.json({ error: "Removing the VEQWERIS footer requires the white-label entitlement." }, { status: 403 });
    }
    const requestedDefinitions = Object.keys(values ?? {}).map((key) => SETTING_REGISTRY.find((setting) => setting.key === key)!);
    if (!isPublish && !isDraft && requestedDefinitions.some((setting) => setting.effect === "requires_approval")) {
      return NextResponse.json({ error: "This change requires a saved impact preview before it can be published." }, { status: 409 });
    }
    const draftId = isPublish ? body.draftId : body.idempotencyKey;
    if (isPublish && (typeof draftId !== "string" || draftId.length < 16 || draftId.length > 128)) {
      return NextResponse.json({ error: "A valid draft identifier is required." }, { status: 400 });
    }
    const draftRef = sectionRef.collection("drafts").doc(hash(`${context.uid}:${context.institutionId}:${draftId}`));
    const requestHash = hash(canonical({
      institutionId: context.institutionId,
      sectionId,
      action: body.action,
      values: values ?? null,
      draftId: isPublish ? draftId : null,
      reason: reasonText,
    }));
    const idempotencyRef = adminDb.collection("requestIdempotency").doc(hash(
      `${context.uid}:${context.institutionId}:settings:${body.idempotencyKey}`,
    ));
    if (isPublish) {
      const prior = await idempotencyRef.get();
      if (prior.exists) {
        if (prior.get("institutionId") !== context.institutionId || prior.get("requestHash") !== requestHash) {
          return NextResponse.json({ error: "This idempotency key was already used for a different settings change." }, { status: 409 });
        }
        return NextResponse.json(prior.get("result"), { status: 200 });
      }
    }
    if (isPublish) {
      const draftSnapshot = await draftRef.get();
      const draftValues = draftSnapshot.data()?.values;
      if (!draftSnapshot.exists || draftSnapshot.get("institutionId") !== context.institutionId
        || draftSnapshot.get("sectionId") !== sectionId || draftSnapshot.get("status") !== "pending"
        || !draftValues || typeof draftValues !== "object" || Array.isArray(draftValues)) {
        return NextResponse.json({ error: "The settings draft is unavailable or already published." }, { status: 404 });
      }
      const validatedDraft = validateSettingsSection(sectionId, draftValues);
      if (Object.keys(validatedDraft).some((key) => key === "profile.whiteLabelFooter" && validatedDraft[key] === true)
        && !await institutionHasFeatureEntitlement(context.institutionId, "white-label-footer")) {
        return NextResponse.json({ error: "Removing the VEQWERIS footer requires the white-label entitlement." }, { status: 403 });
      }
    }
    const auditRef = adminDb.collection("settingsAuditEvents").doc();

    const result = await adminDb.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(
        idempotencyRef,
        sectionRef,
        ...(isPublish ? [draftRef] : []),
      );
      const [idempotency, section] = snapshots;
      if (idempotency.exists) {
        if (idempotency.get("institutionId") !== context.institutionId
          || idempotency.get("requestHash") !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
        return { replay: true, section: idempotency.get("result") };
      }

      const current = section.exists && section.get("institutionId") === context.institutionId
        ? section.get("values") as Record<string, unknown>
        : {};
      let nextValues: Record<string, unknown>;
      let auditAction: string;
      if (isDraft) {
        nextValues = values!;
        auditAction = "institution.settings.draft";
        transaction.create(draftRef, {
          institutionId: context.institutionId,
          sectionId,
          values: nextValues,
          reason: reasonText,
          status: "pending",
          schemaVersion: 1,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        });
      } else if (isPublish) {
        const draftSnapshot = snapshots[2];
        const draftValues = draftSnapshot.data()?.values;
        if (!draftSnapshot.exists || draftSnapshot.get("institutionId") !== context.institutionId
          || draftSnapshot.get("sectionId") !== sectionId || draftSnapshot.get("status") !== "pending"
          || !draftValues || typeof draftValues !== "object" || Array.isArray(draftValues)) {
          throw new Error("DRAFT_NOT_FOUND");
        }
        const validatedDraft = validateSettingsSection(sectionId, draftValues);
        const effects = Object.keys(validatedDraft).map((key) => SETTING_REGISTRY.find((setting) => setting.key === key)!.effect);
        if (effects.some((item) => item === "requires_approval") && reasonText.length < 8) {
          throw new Error("CHANGE_REASON_REQUIRED");
        }
        nextValues = { ...current, ...validatedDraft };
        auditAction = "institution.settings.published";
        transaction.update(draftRef, {
          status: "published",
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        });
      } else {
        nextValues = { ...current, ...values };
        auditAction = "institution.settings.updated";
      }

      if (!isDraft) {
        transaction.set(sectionRef, {
          institutionId: context.institutionId,
          sectionId,
          values: nextValues,
          schemaVersion: 1,
          status: "active",
          createdAt: section.get("createdAt") ?? FieldValue.serverTimestamp(),
          createdBy: section.get("createdBy") ?? context.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        });
      }
      transaction.create(auditRef, {
        eventId: auditRef.id,
        institutionId: context.institutionId,
        action: auditAction,
        actorUid: context.uid,
        occurredAt: FieldValue.serverTimestamp(),
        where: `institutionSettings/${context.institutionId}/sections/${sectionId}`,
        referenceId: isDraft ? draftRef.id : sectionRef.id,
        result: "success",
        previousState: isDraft ? null : current,
        newState: nextValues,
        reason: reasonText,
        schemaVersion: 1,
      });
      const response = { sectionId, status: isDraft ? "draft" : "published", values: nextValues };
      transaction.create(idempotencyRef, {
        institutionId: context.institutionId,
        requestHash,
        result: response,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { replay: false, section: response };
    });
    return NextResponse.json(result.section, { status: result.replay ? 200 : 201 });
  } catch (reason) {
    if (reason instanceof Error && reason.message === "IDEMPOTENCY_CONFLICT") {
      return NextResponse.json({ error: "This idempotency key was already used for a different settings change." }, { status: 409 });
    }
    if (reason instanceof Error && reason.message === "DRAFT_NOT_FOUND") {
      return NextResponse.json({ error: "The settings draft is unavailable or already published." }, { status: 404 });
    }
    if (reason instanceof Error && reason.message === "CHANGE_REASON_REQUIRED") {
      return NextResponse.json({ error: "Provide a specific reason of at least eight characters for this change." }, { status: 400 });
    }
    if (reason instanceof Error && reason.message === "WHITE_LABEL_NOT_ENTITLED") {
      return NextResponse.json({ error: "Removing the VEQWERIS footer requires the white-label entitlement." }, { status: 403 });
    }
    if (reason instanceof Error && (reason.message.startsWith("Invalid ")
      || reason.message.startsWith("Unknown ") || reason.message.startsWith("Setting ")
      || reason.message.startsWith("Settings "))) {
      return NextResponse.json({ error: reason.message }, { status: 400 });
    }
    return authorizationFailure(reason);
  }
}
