import assert from "node:assert/strict";
import {
  CONFIGURATION_PACKS,
  INSTITUTION_TYPES,
  MODULE_REGISTRY,
  getConfigurationPack,
  getInstitutionType,
  previewModuleActivation,
} from "../lib/configuration/registry";
import { hasAccessibleAccentContrast, validateSettingsSection } from "../lib/settings/registry";

assert.equal(INSTITUTION_TYPES.length, 22);
for (const type of INSTITUTION_TYPES) {
  const pack = getConfigurationPack(type);
  assert.ok(pack.departments.length > 0, `${type.code} has departments`);
  assert.ok(pack.operationalUnits.length > 0, `${type.code} has operational units`);
  assert.ok(pack.roleTemplateIds.length > 0, `${type.code} has registered role templates`);
}
assert.notDeepEqual(
  getConfigurationPack(getInstitutionType("clinic")!).departments,
  getConfigurationPack(getInstitutionType("hospital")!).departments,
);
assert.notDeepEqual(
  getConfigurationPack(getInstitutionType("pharmacy")!).departments,
  getConfigurationPack(getInstitutionType("hospital")!).departments,
);
assert.equal(getInstitutionType("ngo")?.generalPackNotice?.includes("future stage"), true);
assert.ok(CONFIGURATION_PACKS["general"]);

const roomService = previewModuleActivation(["room-service"]);
for (const dependency of ["orders", "kitchen", "billing", "inventory", "payments", "hospitality"]) {
  assert.ok(roomService.modules.includes(dependency), `room service enables ${dependency}`);
}
const pharmacy = previewModuleActivation(["pharmacy"]);
for (const dependency of ["healthcare", "prescriptions", "billing", "inventory", "payments"]) {
  assert.ok(pharmacy.modules.includes(dependency), `pharmacy enables ${dependency}`);
}
const wholesale = previewModuleActivation(["wholesale"]);
for (const dependency of ["customers", "invoicing", "inventory", "payments"]) {
  assert.ok(wholesale.modules.includes(dependency), `wholesale enables ${dependency}`);
}
const hospitalLab = previewModuleActivation(["hospital-laboratory"]);
for (const dependency of ["orders", "documents", "inventory", "payments"]) {
  assert.ok(hospitalLab.modules.includes(dependency), `hospital laboratory enables ${dependency}`);
}
assert.throws(() => previewModuleActivation(["not-registered"]));
assert.ok(MODULE_REGISTRY["school-cafeteria"]);
assert.equal(MODULE_REGISTRY.inventory.category, "core");

assert.equal(hasAccessibleAccentContrast("#2563EB"), true);
assert.equal(hasAccessibleAccentContrast("#777777"), false);
assert.equal(hasAccessibleAccentContrast("#invalid"), false);
assert.throws(() => validateSettingsSection("profile", { "profile.accentColor": "#invalid" }));
assert.throws(() => validateSettingsSection("security", { "security.sessionTimeoutMinutes": 3 }));
assert.throws(() => validateSettingsSection("profile", { "security.sessionTimeoutMinutes": 30 }));
assert.throws(() => validateSettingsSection("locale", { "locale.timezone": "not/a-timezone" }));
assert.throws(() => validateSettingsSection("locale", { "locale.currency": "US" }));
assert.throws(() => validateSettingsSection("security", { "security.allowedInviteDomains": ["not-a-domain"] }));
assert.deepEqual(
  validateSettingsSection("profile", { "profile.email": " ADMIN@EXAMPLE.COM " }),
  { "profile.email": "admin@example.com" },
);

console.log("configuration and settings registry tests passed");
