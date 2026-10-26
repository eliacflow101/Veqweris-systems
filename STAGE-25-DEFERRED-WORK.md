# Stage 25 Deferred-Work Register

This register supplements the Stage 25 specification supplied in the project
conversation. It does not supersede that specification. The requested
`docs/VEQWERIS_STANDING_DIRECTIVE.md` and other authoritative roadmap/specification
files were not present in the repository when searched. Stage references below
therefore cite the supplied Stage 25 specification, not an on-disk directive.

## Stage 25 completion blockers

### S25-01 — Role administration experience

- **Source:** Stage 25, Sections 4 and 8.
- **Current state:** Partial. Permission registry, templates, server role API,
  role version history, and bounded assignment-count response exist in
  [`app/api/organization/roles/route.ts`](./app/api/organization/roles/route.ts).
  No Roles & Permissions page, matrix, scope editor, duplicate action, or
  institution-side role history experience was found.
- **Impact:** Roles cannot be safely administered through the required product
  workflow; API availability alone does not satisfy the UX/validation
  requirements.
- **Blocks Stage 25:** Yes.
- **Dependencies:** Permission-driven navigation and the role API.
- **Recommended phase:** Stage 25 UI completion.
- **Evidence to close:** Browser tests for viewing, creating, editing,
  duplicating and assigning a role; matrix grouping and sensitivity/danger
  markers; scope and tier-ceiling validation; audit/version visibility.
- **Classification:** Unresolved Stage 25 requirement, not a later-stage feature.

### S25-02 — Membership/access administration and effective-access explanation

- **Source:** Stage 25, Sections 3, 5, 7 and 8.
- **Current state:** Partial. The Employees page prevents direct system-tier
  edits and can activate/deactivate employees through the membership API.
  Role, scope, unit, team, and location assignment UI and the employee
  effective-access explanation are absent.
- **Impact:** Administrators cannot inspect why a member has access or use the
  required least-privilege assignment workflow.
- **Blocks Stage 25:** Yes.
- **Dependencies:** Role administration, organization entities, and the
  compiled-permission UI read path.
- **Recommended phase:** Stage 25 UI completion.
- **Evidence to close:** Browser tests covering assign/remove, scope-bound
  visibility, reasons/restrictions, and effective-access explanations.
- **Classification:** Unresolved Stage 25 requirement.

### S25-03 — Location, operational-unit, team, and department relationships

- **Source:** Stage 25, Sections 3 and 8.
- **Current state:** Partial. Membership mutation accepts bounded
  department/unit/team/location IDs and verifies referenced records belong to
  the actor's institution. Firestore client access to locations, operational
  units, and teams is denied. Entity lifecycle APIs/pages, relationship
  validation (including unit-to-location and department-to-unit), deactivation
  protections, filters/detail views, and bulk assignment were not found.
- **Impact:** Scope identifiers can be assigned only when pre-existing records
  exist, but the required organization model cannot be managed or fully
  validated.
- **Blocks Stage 25:** Yes.
- **Dependencies:** Role/membership administration and audit transactions.
- **Recommended phase:** Stage 25 organization workflows.
- **Evidence to close:** Tenant-isolation and invalid-parent route tests,
  referential/deactivation tests, audit-failure tests, and UI workflows for all
  required entities.
- **Classification:** Unresolved Stage 25 requirement.

### S25-04 — Permission-driven navigation and client permission hook

- **Source:** Stage 25, Sections 6 and 8.
- **Current state:** Missing. Navigation remains configured statically; no
  `usePermission` hook or verified navigation derivation from the current
  user's compiled permissions was found.
- **Impact:** Menus can present unavailable actions and do not explain access.
  This must not be mistaken for a server-side control.
- **Blocks Stage 25:** Yes.
- **Dependencies:** Safe own-permission read path and permission registry.
- **Recommended phase:** Stage 25 UI completion.
- **Evidence to close:** Tests for generated navigation on permission changes
  and proof that API/server authorization remains authoritative.
- **Classification:** Unresolved Stage 25 requirement.

### S25-05 — Complete authorization migration and permission revocation

- **Source:** Stage 25, Sections 1, 5 and 6.
- **Current state:** Partial. `requirePermission` validates active session,
  profile, membership, compiled permissions, version, tenant, module
  entitlement, scope, and step-up when invoked. Role/membership APIs bump
  permission versions and compile after the transaction. Existing legacy
  role-based rules and many APIs are not migrated to this helper; legacy
  healthcare permissions and role claims remain in Firestore rules.
- **Impact:** The custom permission and scope model is not the effective
  authorization source across the application. In particular, route
  authorization with omitted resource scope cannot enforce a scoped grant.
- **Blocks Stage 25:** Yes.
- **Dependencies:** Full API/rule/storage/data-access inventory; route-specific
  resource-scope mapping.
- **Recommended phase:** Stage 25 authorization completion before new vertical
  work.
- **Evidence to close:** Per-route and per-collection mapping, scoped
  unauthorized-request tests, stale-token tests for direct and server access,
  and proof legacy claims cannot bypass assigned permissions.
- **Classification:** Unresolved security/acceptance defect, not deferred
  convenience work.

### S25-06 — Claims/effective-permission synchronization and recovery

- **Source:** Stage 25, Section 6.
- **Current state:** Partial. API mutations update authorization state and
  audit atomically, then compile effective permissions and synchronize claims.
  If compilation fails, the incremented membership version causes old claims
  to fail the direct Firestore membership comparison and the server
  `requirePermission` version check; replaying an idempotent role mutation can
  retry its pending compilation. However, no automatic trigger for out-of-band
  Admin SDK role/scope/membership writes exists in this repository. No route
  tests inject compiler or claim-update failure.
- **Impact:** API-managed changes fail closed for stale claims, but
  out-of-band changes can leave stale compiled grants until explicit
  synchronization. Recovery/observability behavior is not fully tested.
- **Blocks Stage 25:** Yes, for application-wide automatic compilation and
  complete change coverage.
- **Dependencies:** Deployment architecture decision; inventory of every
  privileged writer.
- **Recommended phase:** Stage 25 authorization completion; do not add Cloud
  Functions without confirmed deployment architecture.
- **Evidence to close:** Failure-injection/retry tests, concurrent-change
  tests, operational recovery instructions, and a verified compiler invocation
  for every supported role/scope/membership mutation source.
- **Classification:** Operational limitation plus unresolved Stage 25 control.

### S25-07 — Owner lifecycle, temporary access, and segregation of duties

- **Source:** Stage 25, Section 7.
- **Current state:** Partial/missing. The membership API refuses all mutations
  to Owner profiles, which prevents that endpoint from deactivating or
  reassigning an Owner. There is no two-step reauthenticated Owner transfer,
  explicit last-active-Owner invariant test, temporary/acting grant expiry
  workflow, or institution-configurable segregation-of-duties enforcement.
- **Impact:** Owner recovery/transfer cannot be completed through the product;
  temporary and conflicting access are not modeled.
- **Blocks Stage 25:** Yes. Owner transfer is explicit Stage 25 scope;
  temporary and segregation controls are also specified there.
- **Dependencies:** Sensitive-action reauthentication, atomic audit, expiry
  lifecycle, transaction-time policy checks.
- **Recommended phase:** Stage 25 security workflow completion.
- **Evidence to close:** Concurrent last-Owner tests, two-step transfer tests,
  expiry tests using server time, and assignment plus transaction-time
  segregation tests.
- **Classification:** Unresolved Stage 25 security requirement.

### S25-08 — External principals

- **Source:** Stage 25, Section 9.
- **Current state:** Partial. Firestore has a separate `portalAccounts` rule
  branch and tests show one external principal cannot read staff documents.
  Linked student/guardian access resolution, invitations/recovery, and broad
  isolation tests for finance/restricted data are not implemented or verified.
- **Impact:** External access is not ready to expose; current safe boundary is
  deny-by-default rather than a complete portal.
- **Blocks Stage 25:** Partial deny-by-default isolation is verified, but the
  specified external-principal requirements remain incomplete.
- **Dependencies:** Linked-record data model and server-side access resolver.
- **Recommended phase:** Stage 25 external-principal scope only if approved;
  otherwise formally defer portal features while retaining deny-by-default
  isolation.
- **Evidence to close:** Student-own-record, guardian-linked-record,
  cross-tenant, staff/finance/restricted denial, recovery, and minor-protection
  tests.
- **Classification:** Unresolved Stage 25 requirement; do not treat the future
  patient portal as in scope.

### S25-09 — Stage 25 API failure, audit, concurrency, and scope coverage

- **Source:** Stage 25, Sections 7 and 11.
- **Current state:** Partial. Emulator tests cover role creation, same-payload
  idempotent replay, mismatched-payload conflict, membership assignment,
  Owner protection, cross-tenant denial, and audit existence on success.
  Role/membership data and audit writes share a Firestore transaction.
  Injected audit failure, compiler failure/recovery, successful update/removal
  lifecycle, concurrent conflicting changes, and comprehensive invalid-scope
  route cases are not verified.
- **Impact:** Atomicity is structurally supported but important failure and
  race guarantees lack direct regression evidence.
- **Blocks Stage 25:** Yes until required authorization and failure cases have
  evidence.
- **Dependencies:** Emulator fault injection or a testable transaction/service
  boundary.
- **Recommended phase:** Stage 25 route-test completion.
- **Evidence to close:** Transaction rollback, retry, concurrency, malformed
  input, privilege escalation, and tenant-scope tests.
- **Classification:** Unresolved verification/security gap.

## Earlier-stage regression and final-audit blockers

### S24-01 — Full Stage 24 readiness and regression audit

- **Source:** Inherited Stages 1–24 and this completion-gate request.
- **Current state:** Partial. This run executes focused import, platform,
  network, payment/refund, capacity, integration, governance, Firestore, and
  Storage tests. It is not a complete audit of every Stage 24 API, rule, data
  path, and invariant.
- **Impact:** Do not infer whole-project readiness from these focused suites.
- **Blocks Stage 25 completion:** It blocks the requested final readiness
  recommendation until the comprehensive audit is complete.
- **Dependencies:** Complete route/rules inventory and approved Stage 24
  acceptance sources.
- **Recommended phase:** Final Stage 24/25 security-readiness audit.
- **Evidence to close:** Requirement-to-test evidence for every affected
  subsystem, plus resolution or explicit escalation of findings.
- **Classification:** Final-audit work, not a later-stage feature.

### S24-02 — Dependency advisories

- **Source:** Inherited Stage 24 dependency-security requirement and this
  completion-gate request.
- **Current state:** Current `npm audit` reports 35 vulnerable package
  entries (16 high, 19 moderate); production-only reports 15 (6 high,
  9 moderate). Production affected entries include Firebase/Firestore and
  gRPC, Firebase Admin/Google Cloud SDK transitives, and Next/PostCSS/source
  maps. The current audit details and installed versions are included in the
  review report. `xlsx` remains absent from package manifest, lockfile, and
  installed dependency tree.
- **Impact:** Production dependency advisories remain; actual exploitability
  varies by configuration and reachable functionality and requires
  advisory-specific assessment.
- **Blocks Stage 25 completion:** Important high findings must be assessed or
  explicitly escalated; no blind major upgrades are authorized.
- **Dependencies:** Compatibility analysis and targeted regression tests.
- **Recommended phase:** Targeted dependency remediation review before release.
- **Evidence to close:** Advisory, affected package/version/path, configuration
  and reachability assessment, compatible remediation decision, and affected
  tests for each material production finding.
- **Classification:** Outstanding security risk, not a later-stage feature.

## Operational controls and known limitations

- **Firestore rule lookup cost:** Current `signedIn()` validates current
  membership; tenant checks also read the institution document. Healthcare
  records may additionally read a user profile and, for compiled permission
  checks, effective permissions. Repeated reads of the same document are
  cached by Firestore rules, but the suite does not measure aggregate billed
  reads or inspect every operation's access-call count. Keep operations
  bounded and validate against Firestore's per-operation and batch limits.
- **Storage:** Direct client access to both `/documents` and `/quarantine` is
  intentionally denied; the Storage suite verifies denial. Server-mediated
  workflows remain responsible for tenant, capacity, and lifecycle checks.
- **Session expiry:** Server authentication now rejects and marks expired
  sessions whose expiry is missing or not a Firestore Timestamp. Emulator
  regression coverage includes this malformed-session case.
- **Authoritative documents:** The requested standing directive and roadmap
  were absent on disk. Do not claim their verification without locating the
  authoritative source.

This register remains open. Passing tests establish only their covered
behaviors and do not close the requirements above.

## Resolved in this continuation

### AUTH-01 — Missing or malformed session expiry

- **Source:** Stage 25, Sections 6, 7 and 11; inherited active-session
  validation.
- **Current state:** Resolved. `verifyActiveSession` now rejects a session if
  `expiresAt` is missing or is not a Firestore `Timestamp`, marks that session
  expired, and rejects already-expired timestamps.
- **Impact:** Prevents malformed active-session records from bypassing
  server-side expiration checks.
- **Blocks Stage 25:** No, this finding is closed.
- **Evidence:** The cookie/session emulator test covers valid credentials,
  missing and invalid credentials, revoked and expired sessions, inactive
  profiles, and a missing expiry value. The platform route emulator suite
  passed.
- **Classification:** Resolved security defect.
