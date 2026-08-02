import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

const validationLabel = "static release-package validation; executable smoke SQL generated but not run locally"
const requiredRoles = ["service_role", "anon", "authenticated"]
const journalPostingSignature = "post_ledger_transaction(text,text,text,text,uuid,text,jsonb,jsonb,text,date,timestamptz,text,text,uuid,text,integer)"
const journalPostingRegprocedure = `public.${journalPostingSignature}`
const requiredExternalObjects = [
  "extension/function gen_random_uuid()",
  "table public.merchants",
  "table public.payments",
  "table public.merchant_providers",
  "table public.payment_events",
  "table public.ledger_entries",
  "table public.merchants",
  "column public.payments.id uuid",
  "column public.payments.merchant_id uuid",
  "column public.payments.status text",
  "column public.payments.gross_amount numeric",
  "column public.payments.currency text-compatible",
  "columns public.payment_events.id/payment_id/event_type/provider_event/raw_payload",
  "columns public.ledger_entries legacy compatibility shape",
  "unique index public.ledger_entries(payment_id)",
]

const contracts = [
  {
    path: "database/migrations/20260731163000_create_ledger_journal_foundation.sql",
    tables: ["ledger_accounts", "ledger_transactions", "ledger_journal_entries", "ledger_links"],
    indexes: ["ledger_accounts_identity_uidx", "ledger_transactions_posting_key_uidx", "ledger_journal_entries_line_uidx", "ledger_links_identity_uidx"],
    functions: ["ledger_history_is_immutable", "ledger_account_identity_is_immutable", "assert_ledger_transaction_balanced", "resolve_ledger_account", "post_ledger_transaction"],
    triggers: ["ledger_transactions_immutable", "ledger_accounts_identity_immutable", "ledger_accounts_undeletable", "ledger_journal_entries_immutable", "ledger_links_immutable"],
    rlsTables: ["ledger_accounts", "ledger_transactions", "ledger_journal_entries", "ledger_links"],
    forceRlsTables: [],
  },
  {
    path: "database/migrations/20260731163100_create_shift4_payment_attempts.sql",
    tables: ["shift4_tender_groups", "shift4_payment_attempts"],
    indexes: ["shift4_tender_groups_payment_connection_uidx", "shift4_payment_attempts_merchant_attempt_uidx", "shift4_payment_attempts_connection_invoice_role_uidx", "shift4_payment_attempts_due_work_idx"],
    functions: ["shift4_tender_group_identity_is_immutable", "shift4_tender_group_is_undeletable", "shift4_canonical_status_path", "shift4_status_event_type", "create_shift4_payment_attempt", "claim_due_shift4_payment_attempts", "apply_shift4_attempt_evidence", "release_shift4_attempt_lease"],
    triggers: ["shift4_tender_groups_identity_immutable", "shift4_tender_groups_undeletable"],
    rlsTables: ["shift4_tender_groups", "shift4_payment_attempts"],
    forceRlsTables: [],
  },
  {
    path: "database/migrations/20260801160000_create_shift4_tokenization_sessions.sql",
    tables: ["shift4_tokenization_sessions"],
    indexes: ["shift4_tokenization_sessions_merchant_payment_idx", "shift4_tokenization_sessions_expiry_idx"],
    functions: ["enforce_shift4_tokenization_session_ownership", "consume_shift4_tokenization_session"],
    triggers: ["shift4_tokenization_session_ownership"],
    rlsTables: ["shift4_tokenization_sessions"],
    forceRlsTables: ["shift4_tokenization_sessions"],
  },
  {
    path: "database/migrations/20260801161000_create_shift4_onboarding_sessions.sql",
    tables: ["shift4_onboarding_sessions", "shift4_onboarding_events"],
    indexes: ["shift4_onboarding_sessions_merchant_created_idx", "shift4_onboarding_sessions_status_idx", "shift4_onboarding_events_session_received_idx", "shift4_onboarding_events_merchant_received_idx"],
    functions: ["shift4_onboarding_guard_ownership", "shift4_onboarding_touch_updated_at", "shift4_onboarding_events_immutable", "create_shift4_onboarding_session", "apply_shift4_onboarding_update"],
    triggers: ["shift4_onboarding_sessions_ownership_trigger", "shift4_onboarding_sessions_updated_at_trigger", "shift4_onboarding_events_immutable_trigger"],
    rlsTables: ["shift4_onboarding_sessions", "shift4_onboarding_events"],
    forceRlsTables: ["shift4_onboarding_sessions", "shift4_onboarding_events"],
  },
  {
    path: "database/migrations/20260802020000_harden_shift4_function_execute_privileges.sql",
    tables: [],
    indexes: [],
    functions: [],
    triggers: [],
    rlsTables: [],
    forceRlsTables: [],
  },
  {
    path: "database/migrations/20260802030000_fix_ledger_posting_link_alias.sql",
    tables: [],
    indexes: [],
    functions: [],
    replacementFunctions: ["post_ledger_transaction"],
    allowCreateOrReplace: true,
    triggers: [],
    rlsTables: [],
    forceRlsTables: [],
  },
]

const sha256 = (value) => createHash("sha256").update(value).digest("hex").toUpperCase()
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ")
const count = (source, pattern) => (source.match(pattern) || []).length
const collectNames = (source, pattern) => [...source.matchAll(pattern)].map((match) => match[1].toLowerCase())
const unique = (values) => [...new Set(values)]
const collectFunctionSignatures = (source) => unique(
  [...source.matchAll(/revoke\s+all\s+on\s+function\s+public\.([a-z][a-z0-9_]*\s*\([\s\S]*?\))\s+from\b/gi)]
    .map((match) => match[1].replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim().toLowerCase()),
)

function validateMigration(contract, source) {
  const executable = stripComments(source)
  const errors = []
  if (count(source, /\$\$/g) % 2 !== 0) errors.push("unbalanced dollar quotes")
  if (count(executable, /^\s*begin\s*;/gim) !== 1) errors.push("expected one top-level BEGIN")
  if (count(executable, /^\s*commit\s*;/gim) !== 1) errors.push("expected one top-level COMMIT")
  if (/create\s+(?:table|index|unique\s+index|function|trigger|policy)\s+if\s+not\s+exists/i.test(executable)) errors.push("non-strict IF NOT EXISTS DDL")
  if (/create\s+or\s+replace/i.test(executable) && !contract.allowCreateOrReplace) errors.push("CREATE OR REPLACE")
  if (/grant\s+all/i.test(executable)) errors.push("GRANT ALL")
  if (/grant\s+(?:insert|update|delete|truncate|references|trigger)[^;]*\b(?:anon|authenticated)\b/i.test(executable)) errors.push("browser write grant")
  if (/\bexecute\s+(?:format\s*\(|immediate\b|[^;]*\|\|)/i.test(executable)) errors.push("dynamic SQL")
  if (/drop\s+table/i.test(executable)) errors.push("destructive table drop")
  if (/on\s+delete\s+cascade/i.test(executable)) errors.push("cascade deletion of evidence")
  if (/select\s+[^;]{0,800}(?:sum|count|min|max|avg)\s*\([^;]{0,800}for\s+(?:update|share)/is.test(executable)) errors.push("aggregate query with locking clause")
  for (const object of contract.tables) if (!new RegExp(`create\\s+table\\s+public\\.${object}\\b`, "i").test(executable)) errors.push(`missing strict table ${object}`)
  for (const object of contract.indexes) if (!new RegExp(`create\\s+(?:unique\\s+)?index\\s+${object}\\b`, "i").test(executable)) errors.push(`missing index ${object}`)
  for (const object of contract.functions) if (!new RegExp(`create\\s+function\\s+public\\.${object}\\b`, "i").test(executable)) errors.push(`missing function ${object}`)
  for (const object of contract.replacementFunctions || []) if (!new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${object}\\b`, "i").test(executable)) errors.push(`missing replacement function ${object}`)
  for (const object of contract.triggers) if (!new RegExp(`create\\s+trigger\\s+${object}\\b`, "i").test(executable)) errors.push(`missing trigger ${object}`)
  const definerFunctions = executable.match(/create\s+(?:or\s+replace\s+)?function[\s\S]*?security\s+definer[\s\S]*?(?=create\s+(?:or\s+replace\s+)?function|commit\s*;)/gi) || []
  if (definerFunctions.some((block) => !/set\s+search_path\s*=/i.test(block))) errors.push("SECURITY DEFINER without pinned search_path")
  if (errors.length) throw new Error(`${basename(contract.path)}: ${errors.join(", ")}`)
}

const sourceRows = await Promise.all(contracts.map(async (contract, index) => {
  const source = await readFile(resolve(contract.path), "utf8")
  validateMigration(contract, source)
  const executable = stripComments(source)
  const discoveredFunctions = unique(collectNames(executable, /create\s+function\s+(?:public\.)?([a-z][a-z0-9_]*)\b/gi))
  const revokedFunctionSignatures = collectFunctionSignatures(executable)
  const discovered = {
    tables: unique(collectNames(executable, /create\s+table\s+(?:public\.)?([a-z][a-z0-9_]*)\b/gi)),
    indexes: unique(collectNames(executable, /create\s+(?:unique\s+)?index\s+([a-z][a-z0-9_]*)\b/gi)),
    functions: discoveredFunctions,
    triggers: unique(collectNames(executable, /create\s+(?:constraint\s+)?trigger\s+([a-z][a-z0-9_]*)\b/gi)),
    constraints: unique(collectNames(executable, /\bconstraint\s+(?!trigger\b)([a-z][a-z0-9_]*)\b/gi)).filter((name) => name.includes("_")),
    functionSignatures: unique([
      ...revokedFunctionSignatures,
      ...discoveredFunctions.filter((name) => !revokedFunctionSignatures.some((signature) => signature.startsWith(`${name}(`))).map((name) => `${name}()`),
    ]),
  }
  for (const kind of ["tables", "indexes", "functions", "triggers"]) {
    for (const expected of contract[kind]) if (!discovered[kind].includes(expected)) throw new Error(`${basename(contract.path)}: expected ${kind} object not discovered: ${expected}`)
  }
  return {
    ...contract,
    ...discovered,
    source,
    releaseEntry: {
      executionOrder: index + 1,
      filename: basename(contract.path),
      path: contract.path,
      sha256: sha256(source),
      byteSize: Buffer.byteLength(source),
      lineCount: source.split(/\r?\n/).length,
      expectedTables: discovered.tables,
      expectedIndexes: discovered.indexes,
      expectedFunctions: discovered.functions,
      expectedFunctionSignatures: discovered.functionSignatures,
      expectedTriggers: discovered.triggers,
      expectedConstraints: discovered.constraints,
      expectedRlsTables: contract.rlsTables,
      expectedForceRlsTables: contract.forceRlsTables,
      requiredRoles,
      requiredExternalObjects,
      runtimeStatus: "not_executed",
    },
  }
}))

const versions = sourceRows.map(({ releaseEntry }) => releaseEntry.filename.slice(0, 14))
if (new Set(versions).size !== versions.length) throw new Error("Migration versions must be unique")
if ([...versions].sort().join("|") !== versions.join("|")) throw new Error("Migration versions must be strictly ordered")
const deployedMigrationHashes = [
  "3D38B541E31CF089AC504CB023B3A1C04311C1110D67A4C98E564345417616DF",
  "3D2A838AA7A0F9F56CF3F4032D6B0DC6632BDA57D475029A41CC4D3605BA8F9E",
  "5E0A6014A0801F503EEA73A7F84740907470D80B43A0B8BF14C6AB71677867FC",
  "E208AD4D0677A6A6601586D399105E9309EBD2D021E6935DC2F66B79EB84E940",
  "696F3CCFD8C41240F075FB41E9B80699A84C22511F5A6ECAAF640ED6540F6FDD",
]
for (const [index, expectedHash] of deployedMigrationHashes.entries()) {
  if (sourceRows[index].releaseEntry.sha256 !== expectedHash) throw new Error(`Deployed migration ${index + 1} hash changed`)
}
const aliasFixMigration = stripComments(sourceRows[5].source)
const aliasFixNormalized = aliasFixMigration.replace(/\s+/g, " ")
if (!aliasFixNormalized.includes("select link_item.value ->> 'payment_id' into v_payment_link from jsonb_array_elements(p_links) as link_item(value)")) throw new Error("Migration 6 payment-link extraction must use an explicit value alias")
if (/\bas\s+v_link\b/i.test(aliasFixMigration) || /\bv_link\s+jsonb\s*;/i.test(aliasFixMigration)) throw new Error("Migration 6 retains a PL/pgSQL variable versus SQL alias collision")
const jsonArrayRanges = aliasFixMigration.split("\n").filter((line) => line.includes("jsonb_array_elements("))
if (jsonArrayRanges.length !== 9 || jsonArrayRanges.some((line) => !/as (?:line_item|link_item)\(value\)/.test(line))) throw new Error("Migration 6 must explicitly alias every jsonb_array_elements value")
for (const kind of ["tables", "indexes", "functions", "triggers", "constraints"]) {
  const names = sourceRows.flatMap((row) => row[kind])
  if (new Set(names).size !== names.length) throw new Error(`Release contains duplicate ${kind} names`)
}

const rpcContracts = [
  ["database/shift4PaymentAttempts.ts", ["create_shift4_payment_attempt", "apply_shift4_attempt_evidence", "claim_due_shift4_payment_attempts", "release_shift4_attempt_lease"]],
  ["database/shift4TokenizationSessions.ts", ["consume_shift4_tokenization_session"]],
  ["database/shift4OnboardingSessions.ts", ["create_shift4_onboarding_session", "apply_shift4_onboarding_update"]],
]
const allSql = sourceRows.map(({ source }) => source).join("\n")
for (const [path, names] of rpcContracts) {
  const source = await readFile(resolve(path), "utf8")
  for (const name of names) {
    if (!source.includes(`rpc("${name}"`)) throw new Error(`${path}: missing TypeScript RPC call ${name}`)
    if (!new RegExp(`create\\s+function\\s+public\\.${name}\\b`, "i").test(allSql)) throw new Error(`${path}: migration function missing for RPC ${name}`)
  }
}

const manifest = {
  schemaVersion: 1,
  package: "pinetree-shift4-database-release",
  validation: validationLabel,
  runtimeStatus: "not_executed",
  contactedDatabase: false,
  migrationCount: sourceRows.length,
  migrations: sourceRows.map(({ releaseEntry }) => releaseEntry),
}

const tables = sourceRows.flatMap(({ tables }) => tables)
const indexes = sourceRows.flatMap(({ indexes }) => indexes)
const functions = sourceRows.flatMap(({ functions }) => functions)
const functionSignatures = unique(sourceRows.flatMap(({ functionSignatures }) => functionSignatures))
const triggers = sourceRows.flatMap(({ triggers }) => triggers)
const constraints = sourceRows.flatMap(({ constraints }) => constraints)
const rlsTables = sourceRows.flatMap(({ rlsTables }) => rlsTables)
const forceRlsTables = sourceRows.flatMap(({ forceRlsTables }) => forceRlsTables)
const sqlList = (values) => values.map((value) => `'${value}'`).join(",")

const preflight = `-- PineTree Shift4 database release preflight\n-- ${validationLabel}; read-only when executed.\nDO $$\nDECLARE\n  v_missing text;\nBEGIN\n  IF current_setting('server_version_num')::integer < 140000 THEN RAISE EXCEPTION 'PostgreSQL 14 or newer is required'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN RAISE EXCEPTION 'service_role is required'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN RAISE EXCEPTION 'anon is required'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN RAISE EXCEPTION 'authenticated is required'; END IF;\n  IF to_regprocedure('gen_random_uuid()') IS NULL THEN RAISE EXCEPTION 'gen_random_uuid() is required'; END IF;\n  IF to_regclass('public.merchants') IS NULL OR to_regclass('public.payments') IS NULL OR to_regclass('public.merchant_providers') IS NULL THEN RAISE EXCEPTION 'Required PineTree parent relations are missing'; END IF;\n  SELECT string_agg(required.column_name, ', ') INTO v_missing\n    FROM (VALUES ('id','uuid'),('merchant_id','uuid'),('status','text')) required(column_name,data_type)\n    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='payments' AND c.column_name=required.column_name AND c.data_type=required.data_type);\n  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'payments columns/types missing: %', v_missing; END IF;\n  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${sqlList(tables)})) THEN RAISE EXCEPTION 'Release object collision detected'; END IF;\n  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${sqlList(functions)})) THEN RAISE EXCEPTION 'Release function collision detected'; END IF;\n  IF EXISTS (SELECT 1 FROM pg_event_trigger) AND current_user IN ('anon','authenticated') THEN RAISE EXCEPTION 'Browser role cannot own migration execution'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND contype='p') THEN RAISE EXCEPTION 'payments primary-key lifecycle assumption failed'; END IF;\nEND;\n$$;\nSELECT current_user AS migration_actor, current_database() AS database_name, current_setting('server_version') AS postgres_version;\n`

const postflight = `-- PineTree Shift4 database release postflight\n-- ${validationLabel}; run after the pending fifth migration.\nDO $$\nDECLARE\n  v_name text;\n  v_signature text;\n  v_grantee text;\nBEGIN\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(tables)}] LOOP\n    IF to_regclass('public.' || v_name) IS NULL THEN RAISE EXCEPTION 'Missing table: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(indexes)}] LOOP\n    IF to_regclass('public.' || v_name) IS NULL THEN RAISE EXCEPTION 'Missing index: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(functions)}] LOOP\n    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN RAISE EXCEPTION 'Missing function: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(triggers)}] LOOP\n    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=v_name AND NOT tgisinternal) THEN RAISE EXCEPTION 'Missing trigger: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(rlsTables)}] LOOP\n    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=v_name AND c.relrowsecurity) THEN RAISE EXCEPTION 'RLS missing: %', v_name; END IF;\n  END LOOP;\n  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND p.proname IN (${sqlList(functions)}) AND coalesce(array_to_string(p.proconfig,','),'') NOT LIKE '%search_path=%') THEN RAISE EXCEPTION 'SECURITY DEFINER function lacks pinned search_path'; END IF;\n  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN (${sqlList(tables)}) AND grantee IN ('anon','authenticated') AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) THEN RAISE EXCEPTION 'Unexpected browser write privilege'; END IF;\n  SELECT p.proname, pg_get_function_identity_arguments(p.oid), coalesce(grantee.rolname, 'PUBLIC')\n    INTO v_name, v_signature, v_grantee\n    FROM pg_proc p\n    JOIN pg_namespace n ON n.oid=p.pronamespace\n    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl_entry\n    LEFT JOIN pg_roles grantee ON grantee.oid=acl_entry.grantee\n   WHERE n.nspname='public'\n     AND p.proname IN (${sqlList(functions)})\n     AND acl_entry.privilege_type='EXECUTE'\n     AND coalesce(grantee.rolname, 'PUBLIC') IN ('PUBLIC','anon','authenticated')\n   ORDER BY p.proname, pg_get_function_identity_arguments(p.oid), coalesce(grantee.rolname, 'PUBLIC')\n   LIMIT 1;\n  IF FOUND THEN\n    RAISE EXCEPTION 'Unexpected function EXECUTE privilege: public.%(%) grantee=%', v_name, v_signature, v_grantee;\n  END IF;\nEND;\n$$;\nSELECT schemaname, tablename, policyname, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN (${sqlList(rlsTables)}) ORDER BY tablename, policyname;\nSELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS signature, r.rolname AS owner, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.proname IN (${sqlList(functions)}) ORDER BY p.proname;\n`

const hardenedPreflight = preflight.replace(
  "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND contype='p') THEN RAISE EXCEPTION 'payments primary-key lifecycle assumption failed'; END IF;",
  `  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND contype='p') THEN RAISE EXCEPTION 'payments primary-key lifecycle assumption failed'; END IF;\n  IF current_user IN ('anon','authenticated','service_role') THEN RAISE EXCEPTION 'Migration owner must be a dedicated privileged owner, not an application role'; END IF;\n  IF to_regclass('public.payment_events') IS NULL OR to_regclass('public.ledger_entries') IS NULL THEN RAISE EXCEPTION 'Required lifecycle/legacy ledger relations are missing'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='gross_amount' AND data_type='numeric') THEN RAISE EXCEPTION 'payments.gross_amount numeric assumption failed'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='currency' AND data_type IN ('text','character varying','character')) THEN RAISE EXCEPTION 'payments.currency text assumption failed'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_events' AND column_name='raw_payload' AND data_type IN ('json','jsonb')) THEN RAISE EXCEPTION 'payment_events.raw_payload JSON assumption failed'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='ledger_entries' AND i.indisunique AND i.indnatts=1 AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=c.oid AND attname='payment_id' AND NOT attisdropped)) THEN RAISE EXCEPTION 'legacy ledger_entries(payment_id) uniqueness assumption failed'; END IF;\n  IF EXISTS (SELECT 1 FROM (VALUES ('payment.reconciled'),('payment.pending'),('payment.processing'),('payment.confirmed'),('payment.failed'),('payment.canceled'),('payment.expired'),('payment.incomplete')) required(value) WHERE EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_events'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%payment.%' AND pg_get_constraintdef(oid) NOT LIKE ('%' || required.value || '%'))) THEN RAISE EXCEPTION 'payment_events event-type compatibility assumption failed'; END IF;`,
)
  .replace("PineTree Shift4 database release preflight", "PineTree Shift4 privilege-correction release preflight")
  .replace(
    "DO $$\nDECLARE\n  v_missing text;",
    () => "-- The four foundation migrations must already be installed; only migration 5 is pending.\nDO $$\nDECLARE\n  v_missing text;\n  v_name text;",
  )
  .replace(
    "  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (" + sqlList(tables) + ")) THEN RAISE EXCEPTION 'Release object collision detected'; END IF;\n  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (" + sqlList(functions) + ")) THEN RAISE EXCEPTION 'Release function collision detected'; END IF;",
    `  FOREACH v_name IN ARRAY ARRAY[${sqlList(tables)}] LOOP\n    IF to_regclass('public.' || v_name) IS NULL THEN RAISE EXCEPTION 'Installed foundation table is missing: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(functions)}] LOOP\n    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN RAISE EXCEPTION 'Installed foundation function is missing: %', v_name; END IF;\n  END LOOP;`,
  )

const aliasFixPreflight = hardenedPreflight.replace(
  "The four foundation migrations must already be installed; only migration 5 is pending.",
  "The five deployed migrations must already be installed; only migration 6 is pending.",
)

const postflightTag = "$postflight$"
const namedPostflight = postflight
  .replace("DO $$", `DO ${postflightTag}`)
  .replace("\n$$;\nSELECT schemaname", () => `\n${postflightTag};\nSELECT schemaname`)

const hardenedPostflight = namedPostflight.replace(
  "  IF EXISTS (SELECT 1 FROM pg_proc",
  `  FOREACH v_name IN ARRAY ARRAY[${sqlList(functionSignatures)}] LOOP\n    IF to_regprocedure('public.' || v_name) IS NULL THEN RAISE EXCEPTION 'Missing exact function signature: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(constraints)}] LOOP\n    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=v_name) THEN RAISE EXCEPTION 'Missing constraint: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(forceRlsTables)}] LOOP\n    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=v_name AND c.relforcerowsecurity) THEN RAISE EXCEPTION 'FORCE RLS missing: %', v_name; END IF;\n  END LOOP;\n  IF to_regprocedure('public.consume_shift4_tokenization_session(uuid,uuid,text,text)') IS NULL THEN RAISE EXCEPTION 'Exact token-consumption RPC signature missing'; END IF;\n  IF to_regprocedure('public.create_shift4_onboarding_session(uuid,uuid,text,text,text,text,text)') IS NULL THEN RAISE EXCEPTION 'Exact onboarding-create RPC signature missing'; END IF;\n  IF to_regprocedure('public.apply_shift4_onboarding_update(uuid,uuid,text,text,text,text,timestamp with time zone,text,boolean,text)') IS NULL THEN RAISE EXCEPTION 'Exact onboarding-update RPC signature missing'; END IF;\n  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='shift4_tokenization_sessions' AND grantee='service_role' AND privilege_type='UPDATE') THEN RAISE EXCEPTION 'service_role must consume tokenization sessions only through the RPC'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='shift4_tokenization_sessions' AND grantee='service_role' AND privilege_type='INSERT' AND column_name='session_id') THEN RAISE EXCEPTION 'service_role tokenization creation privilege missing'; END IF;\n  IF EXISTS (SELECT 1 FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='shift4_tokenization_sessions' AND grantee='service_role' AND privilege_type='INSERT' AND column_name IN ('token_fingerprint','consumed_at')) THEN RAISE EXCEPTION 'service_role tokenization INSERT columns are overprivileged'; END IF;\n  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.proname IN (${sqlList(functions)}) AND r.rolname IN ('PUBLIC','anon','authenticated','service_role')) THEN RAISE EXCEPTION 'Release function has unsafe owner role'; END IF;\n  IF EXISTS (SELECT 1 FROM pg_proc`,
)

const aliasFixPostflight = hardenedPostflight
  .replace("pending fifth migration", "pending sixth migration")
  .replace(
    `END;\n${postflightTag};\nSELECT schemaname`,
    () => `  IF to_regprocedure('${journalPostingRegprocedure}') IS NULL THEN RAISE EXCEPTION 'Exact post_ledger_transaction signature missing'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=to_regprocedure('${journalPostingRegprocedure}') AND r.rolname='postgres') THEN RAISE EXCEPTION 'post_ledger_transaction owner must be postgres'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('${journalPostingRegprocedure}') AND p.prosecdef) THEN RAISE EXCEPTION 'post_ledger_transaction must be SECURITY DEFINER'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('${journalPostingRegprocedure}') AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]) THEN RAISE EXCEPTION 'post_ledger_transaction search_path must be pinned to public, pg_temp'; END IF;\n  IF has_function_privilege('anon', '${journalPostingRegprocedure}', 'EXECUTE') OR has_function_privilege('authenticated', '${journalPostingRegprocedure}', 'EXECUTE') THEN RAISE EXCEPTION 'Browser roles must not execute post_ledger_transaction'; END IF;\n  IF NOT has_function_privilege('service_role', '${journalPostingRegprocedure}', 'EXECUTE') THEN RAISE EXCEPTION 'service_role execute privilege missing for post_ledger_transaction'; END IF;\nEND;\n${postflightTag};\nSELECT schemaname`,
  )
const securedAliasFixPostflight = aliasFixPostflight.replace(
  "  IF has_function_privilege('anon'",
  `  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl_entry WHERE p.oid=to_regprocedure('${journalPostingRegprocedure}') AND acl_entry.grantee=0 AND acl_entry.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'PUBLIC must not execute post_ledger_transaction'; END IF;\n  IF has_function_privilege('anon'`,
)
const postflightDollarTags = securedAliasFixPostflight.match(/\$[a-z_][a-z0-9_]*\$/gi) || []
if (postflightDollarTags.length !== 2 || postflightDollarTags.some((tag) => tag !== postflightTag)) throw new Error("03-postflight.sql: DO block must use one matching named dollar tag")
if (!securedAliasFixPostflight.includes(`DO ${postflightTag}\nDECLARE`) || !securedAliasFixPostflight.includes(`END;\n${postflightTag};\nSELECT`)) throw new Error("03-postflight.sql: named DO block boundary is malformed")
if (/Added by Supabase|ALTER\s+TABLE\s+v_name|dashboard(?:\s+session|\s+user|\s+date)|```/i.test(securedAliasFixPostflight)) throw new Error("03-postflight.sql: dashboard-generated or markdown content is forbidden")
if (securedAliasFixPostflight.trimEnd().endsWith('"')) throw new Error("03-postflight.sql: trailing double quote is forbidden")
const postflightWithoutStrings = stripComments(securedAliasFixPostflight).replace(/'(?:''|[^'])*'/g, "''")
if (/\b(?:create|alter|drop|grant|revoke|insert|update|delete|truncate|notify)\b/i.test(postflightWithoutStrings)) throw new Error("03-postflight.sql: postflight must remain read-only")


const containment = `-- PineTree Shift4 containment; preserves financial and certification evidence.\n-- 1. Set every SHIFT4_* enablement flag false through controlled deployment configuration.\n-- 2. Stop new Shift4 checkout, POS, onboarding, and certification-fixture traffic.\n-- 3. Keep read-only invoice lookup/reconciliation available only under incident approval.\n-- 4. Do not DROP, TRUNCATE, DELETE, or rewrite attempts, tenders, journal, tokenization, onboarding, or evidence.\n-- 5. Verify production_processing readiness is blocked before resuming general traffic.\nSELECT state, recovery_state, count(*) FROM public.shift4_payment_attempts GROUP BY state, recovery_state ORDER BY state, recovery_state;\nSELECT status, count(*) FROM public.shift4_onboarding_sessions GROUP BY status ORDER BY status;\n`

const hardenedSmoke = await readFile(resolve("scripts", "shift4-database", "smoke-tests.sql"), "utf8")
const smokeExecutable = stripComments(hardenedSmoke)
const requiredSmokeCases = [
  "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S09b",
  "S10", "S11", "S12", "S13", "S14", "S15", "S16", "S17", "S18", "S19",
]
for (const smokeCase of requiredSmokeCases) {
  if (!new RegExp(`RAISE\\s+NOTICE\\s+'${smokeCase}\\b`, "i").test(smokeExecutable)) {
    throw new Error(`04-smoke-tests.sql: ${smokeCase} is not an executable rollback-contained assertion`)
  }
}
if (/^\s*--\s*S(?:0[1-9]|1[0-9])\b/im.test(hardenedSmoke)) throw new Error("04-smoke-tests.sql: comment-only S01-S19 placeholder detected")
if (!/^\s*BEGIN\s*;/im.test(smokeExecutable) || !/ROLLBACK\s*;\s*$/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: transaction must begin and end with ROLLBACK")
if (/^\s*COMMIT\s*;/im.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: COMMIT is forbidden")
if (!/RAISE\s+EXCEPTION/iu.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: executable fail-fast assertions are required")
if (/00000000-0000-0000-0000-00000000000[1-4]/i.test(hardenedSmoke)) throw new Error("04-smoke-tests.sql: operator UUID placeholders are forbidden")
for (const identifier of ["v_merchant_id", "v_payment_a_id", "v_payment_b_id", "v_connection_id"]) {
  if (!new RegExp(`\\b${identifier}\\s+uuid\\s*:=\\s*gen_random_uuid\\(\\)`, "i").test(smokeExecutable)) {
    throw new Error(`04-smoke-tests.sql: ${identifier} must be generated transaction-locally`)
  }
}
if (/v_operator_confirms|operator configuration block/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: external operator fixture configuration is forbidden")
if (/v_connection_[2-9]_id/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: only one Shift4 connection may be configured")
if (!/v_payment_a_id\s*=\s*v_payment_b_id/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: distinct payment rows must be enforced")
const smokeLower = smokeExecutable.toLowerCase()
const outerBeginIndex = smokeLower.indexOf("begin;")
const merchantInsertIndex = smokeLower.indexOf("insert into public.merchants")
const connectionInsertIndex = smokeLower.indexOf("insert into public.merchant_providers")
const paymentsInsertIndex = smokeLower.indexOf("insert into public.payments")
if (!(outerBeginIndex >= 0 && merchantInsertIndex > outerBeginIndex && connectionInsertIndex > merchantInsertIndex && paymentsInsertIndex > connectionInsertIndex)) {
  throw new Error("04-smoke-tests.sql: synthetic merchant, connection, and payments must be inserted after BEGIN in dependency order")
}
if (!/insert\s+into\s+public\.merchants\s*\(\s*id,\s*email,\s*business_name,\s*created_at\s*\)/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: synthetic merchant insert contract is missing")
if (/\bm\.provider\b/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: nonexistent merchants.provider must not be referenced")
if (!/insert\s+into\s+public\.merchant_providers\s*\(\s*id,\s*merchant_id,\s*provider,\s*enabled,\s*credentials,\s*created_at,\s*updated_at\s*\)\s*values\s*\(\s*v_connection_id,\s*v_merchant_id,\s*'shift4_rest',\s*true,/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: enabled synthetic shift4_rest connection must use the schema-default status")
if (!/insert\s+into\s+public\.payments\s*\(\s*id,\s*merchant_id,\s*subtotal_amount,\s*platform_fee,\s*total_amount,\s*merchant_amount,\s*pinetree_fee,\s*gross_amount/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: dual-model synthetic payment money insert is missing")
if (!/v_payment_a_id,\s*v_merchant_id,\s*200,\s*15,\s*215,\s*2\.00,\s*0\.15,\s*2\.15/i.test(smokeExecutable) || !/v_payment_b_id,\s*v_merchant_id,\s*300,\s*15,\s*315,\s*3\.00,\s*0\.15,\s*3\.15/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: synthetic payments must keep bigint and numeric money models exact")
if (!/mp\.provider='shift4_rest'\s+AND\s+mp\.status='active'\s+AND\s+mp\.enabled=true/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: synthetic connection must validate the active default status")
if (!/Final containment assertions passed for generated rollback-only fixtures/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: final fixture containment assertion is missing")
for (const payment of ["a", "b"]) {
  if (!new RegExp(`payment ${payment.toUpperCase()} does not belong to synthetic merchant`, "i").test(smokeExecutable)) throw new Error(`04-smoke-tests.sql: payment ${payment.toUpperCase()} ownership validation is missing`)
  if (!new RegExp(`Unsafe payment ${payment.toUpperCase()} status`, "i").test(smokeExecutable)) throw new Error(`04-smoke-tests.sql: payment ${payment.toUpperCase()} CREATED-state validation is missing`)
  if (!new RegExp(`Synthetic payment ${payment.toUpperCase()} requires exact dual-model USD/CAD money`, "i").test(smokeExecutable)) throw new Error(`04-smoke-tests.sql: payment ${payment.toUpperCase()} amount/currency validation is missing`)
  const row = `v_payment_${payment}`
  for (const assertion of [
    `${row}.subtotal_amount <> ${row}.merchant_amount * 100`,
    `${row}.platform_fee <> ${row}.pinetree_fee * 100`,
    `${row}.total_amount <> ${row}.gross_amount * 100`,
    `${row}.subtotal_amount + ${row}.platform_fee <> ${row}.total_amount`,
    `${row}.merchant_amount + ${row}.pinetree_fee <> ${row}.gross_amount`,
  ]) {
    if (!smokeExecutable.includes(assertion)) throw new Error(`04-smoke-tests.sql: payment ${payment.toUpperCase()} is missing exact dual-model money assertion: ${assertion}`)
  }
  if (!new RegExp(`Unsafe non-pristine payment ${payment.toUpperCase()}`, "i").test(smokeExecutable)) throw new Error(`04-smoke-tests.sql: payment ${payment.toUpperCase()} pristine-state validation is missing`)
}
if (!/S19 payment and tender-group isolation passed/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: payment-boundary S19 is missing")
if (!/S06 nonexistent payment-event ledger-link rejection passed/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: S06 must describe the tested ledger-link rejection")
if (!/S05 account\/merchant mismatch was not rejected:/i.test(smokeExecutable) || !/S05 account and merchant mismatch passed/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: S05 account/merchant mismatch contract changed")
if (/\B:(?:merchant_id|payment_id|connection_id)\b/i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: psql variables are not Supabase SQL Editor compatible")
if (/\b(?:pg_net|net\.http|http_get|http_post|curl|fetch)\b|https?:\/\//i.test(smokeExecutable)) throw new Error("04-smoke-tests.sql: provider/network access is forbidden")

const applyOrder = `# Installed foundation migrations (do not rerun)\n${sourceRows.slice(0, 4).map(({ releaseEntry }) => `${releaseEntry.executionOrder}. ${releaseEntry.path}  SHA256=${releaseEntry.sha256}`).join("\n")}\n# Pending forward-only privilege migration\n${sourceRows.slice(4).map(({ releaseEntry }) => `${releaseEntry.executionOrder}. ${releaseEntry.path}  SHA256=${releaseEntry.sha256}`).join("\n")}\n`
const checklist = `# Shift4 database release operator checklist\n\n- [ ] Confirm the four foundation migrations listed as installed in 02-apply-order.txt are present; do not rerun them.\n- [ ] Confirm an approved disposable/staging PostgreSQL target; never infer production authorization.\n- [ ] Verify all feature flags remain disabled.\n- [ ] Verify every migration SHA-256 against 00-manifest.json.\n- [ ] Run 01-preflight.sql read-only and resolve every exception.\n- [ ] Apply only migration 5, 20260802020000_harden_shift4_function_execute_privileges.sql, using the approved migration mechanism.\n- [ ] Run 03-postflight.sql and retain its complete output.\n- [ ] Run 04-smoke-tests.sql without supplying merchant, connection, payment, credential, or customer data; it generates all synthetic fixtures inside its rollback-only transaction.\n- [ ] Confirm the smoke success result is returned, final containment assertions pass, and the last statement is ROLLBACK.\n- [ ] Record runtime evidence separately; this repository package says not_executed.\n- [ ] If any gate fails, follow 05-containment.sql and preserve all evidence.\n- [ ] Enable no Shift4 traffic until provider credentials, certification, device, onboarding, and production gates are separately approved.\n`

if (!applyOrder.includes("Pending forward-only privilege migration") || !checklist.includes("Apply only migration 5")) {
  throw new Error("Legacy five-migration release handoff contract changed unexpectedly")
}
const aliasFixApplyOrder = `# Installed migrations (do not rerun)\n${sourceRows.slice(0, 5).map(({ releaseEntry }) => `${releaseEntry.executionOrder}. ${releaseEntry.path}  SHA256=${releaseEntry.sha256}`).join("\n")}\n# Pending forward-only journal function correction\n${sourceRows.slice(5).map(({ releaseEntry }) => `${releaseEntry.executionOrder}. ${releaseEntry.path}  SHA256=${releaseEntry.sha256}`).join("\n")}\n`
const aliasFixChecklist = `# Shift4 database release operator checklist\n\n- [ ] Confirm migrations 1-5 listed as installed in 02-apply-order.txt are present and hash-exact; do not rerun them.\n- [ ] Confirm an approved disposable/staging PostgreSQL target; never infer production authorization.\n- [ ] Verify all feature flags remain disabled.\n- [ ] Verify every migration SHA-256 against 00-manifest.json.\n- [ ] Run 01-preflight.sql read-only and resolve every exception.\n- [ ] Apply only migration 6, 20260802030000_fix_ledger_posting_link_alias.sql, using the approved migration mechanism.\n- [ ] Run 03-postflight.sql and retain its complete output, including exact post_ledger_transaction owner, SECURITY DEFINER, search_path, and EXECUTE checks.\n- [ ] Run 04-smoke-tests.sql without supplying merchant, connection, payment, credential, or customer data; it generates all synthetic fixtures inside its rollback-only transaction.\n- [ ] Confirm S05 rejects account/merchant mismatch, the smoke success result is returned, final containment assertions pass, and the last statement is ROLLBACK.\n- [ ] Record runtime evidence separately; this repository package says not_executed.\n- [ ] If any gate fails, follow 05-containment.sql and preserve all evidence.\n- [ ] Enable no Shift4 traffic until provider credentials, certification, device, onboarding, and production gates are separately approved.\n`

const artifacts = {
  "00-manifest.json": JSON.stringify(manifest, null, 2) + "\n",
  "01-preflight.sql": aliasFixPreflight,
  "02-apply-order.txt": aliasFixApplyOrder,
  "03-postflight.sql": securedAliasFixPostflight,
  "04-smoke-tests.sql": hardenedSmoke,
  "05-containment.sql": containment,
  "06-operator-checklist.md": aliasFixChecklist,
}
const outputDirectory = resolve("artifacts", "shift4-database")
await mkdir(outputDirectory, { recursive: true })
for (const [name, content] of Object.entries(artifacts)) await writeFile(resolve(outputDirectory, name), content)

const artifactHashes = Object.fromEntries(Object.entries(artifacts).map(([name, content]) => [name, sha256(content)]))
console.log(JSON.stringify({ ok: true, validation: validationLabel, runtimeStatus: "not_executed", contactedDatabase: false, migrations: sourceRows.length, artifacts: Object.keys(artifacts).length, manifestSha256: artifactHashes["00-manifest.json"], artifactHashes }))
