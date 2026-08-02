import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

const validationLabel = "static source validation only"
const requiredRoles = ["service_role", "anon", "authenticated"]
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
    forceRlsTables: [],
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
  if (/create\s+or\s+replace/i.test(executable)) errors.push("CREATE OR REPLACE")
  if (/grant\s+all/i.test(executable)) errors.push("GRANT ALL")
  if (/grant\s+(?:insert|update|delete|truncate|references|trigger)[^;]*\b(?:anon|authenticated)\b/i.test(executable)) errors.push("browser write grant")
  if (/\bexecute\s+(?:format\s*\(|immediate\b|[^;]*\|\|)/i.test(executable)) errors.push("dynamic SQL")
  if (/drop\s+table/i.test(executable)) errors.push("destructive table drop")
  if (/on\s+delete\s+cascade/i.test(executable)) errors.push("cascade deletion of evidence")
  if (/select\s+[^;]{0,800}(?:sum|count|min|max|avg)\s*\([^;]{0,800}for\s+(?:update|share)/is.test(executable)) errors.push("aggregate query with locking clause")
  for (const object of contract.tables) if (!new RegExp(`create\\s+table\\s+public\\.${object}\\b`, "i").test(executable)) errors.push(`missing strict table ${object}`)
  for (const object of contract.indexes) if (!new RegExp(`create\\s+(?:unique\\s+)?index\\s+${object}\\b`, "i").test(executable)) errors.push(`missing index ${object}`)
  for (const object of contract.functions) if (!new RegExp(`create\\s+function\\s+public\\.${object}\\b`, "i").test(executable)) errors.push(`missing function ${object}`)
  for (const object of contract.triggers) if (!new RegExp(`create\\s+trigger\\s+${object}\\b`, "i").test(executable)) errors.push(`missing trigger ${object}`)
  const definerFunctions = executable.match(/create\s+function[\s\S]*?security\s+definer[\s\S]*?(?=create\s+function|commit\s*;)/gi) || []
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
const functionSignatures = sourceRows.flatMap(({ functionSignatures }) => functionSignatures)
const triggers = sourceRows.flatMap(({ triggers }) => triggers)
const constraints = sourceRows.flatMap(({ constraints }) => constraints)
const rlsTables = sourceRows.flatMap(({ rlsTables }) => rlsTables)
const forceRlsTables = sourceRows.flatMap(({ forceRlsTables }) => forceRlsTables)
const sqlList = (values) => values.map((value) => `'${value}'`).join(",")

const preflight = `-- PineTree Shift4 database release preflight\n-- ${validationLabel}; read-only when executed.\nDO $$\nDECLARE\n  v_missing text;\nBEGIN\n  IF current_setting('server_version_num')::integer < 140000 THEN RAISE EXCEPTION 'PostgreSQL 14 or newer is required'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN RAISE EXCEPTION 'service_role is required'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN RAISE EXCEPTION 'anon is required'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN RAISE EXCEPTION 'authenticated is required'; END IF;\n  IF to_regprocedure('gen_random_uuid()') IS NULL THEN RAISE EXCEPTION 'gen_random_uuid() is required'; END IF;\n  IF to_regclass('public.merchants') IS NULL OR to_regclass('public.payments') IS NULL OR to_regclass('public.merchant_providers') IS NULL THEN RAISE EXCEPTION 'Required PineTree parent relations are missing'; END IF;\n  SELECT string_agg(required.column_name, ', ') INTO v_missing\n    FROM (VALUES ('id','uuid'),('merchant_id','uuid'),('status','text')) required(column_name,data_type)\n    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='payments' AND c.column_name=required.column_name AND c.data_type=required.data_type);\n  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'payments columns/types missing: %', v_missing; END IF;\n  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${sqlList(tables)})) THEN RAISE EXCEPTION 'Release object collision detected'; END IF;\n  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${sqlList(functions)})) THEN RAISE EXCEPTION 'Release function collision detected'; END IF;\n  IF EXISTS (SELECT 1 FROM pg_event_trigger) AND current_user IN ('anon','authenticated') THEN RAISE EXCEPTION 'Browser role cannot own migration execution'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND contype='p') THEN RAISE EXCEPTION 'payments primary-key lifecycle assumption failed'; END IF;\nEND;\n$$;\nSELECT current_user AS migration_actor, current_database() AS database_name, current_setting('server_version') AS postgres_version;\n`

const postflight = `-- PineTree Shift4 database release postflight\n-- ${validationLabel}; run after all four migrations.\nDO $$\nDECLARE v_name text;\nBEGIN\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(tables)}] LOOP\n    IF to_regclass('public.' || v_name) IS NULL THEN RAISE EXCEPTION 'Missing table: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(indexes)}] LOOP\n    IF to_regclass('public.' || v_name) IS NULL THEN RAISE EXCEPTION 'Missing index: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(functions)}] LOOP\n    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name) THEN RAISE EXCEPTION 'Missing function: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(triggers)}] LOOP\n    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=v_name AND NOT tgisinternal) THEN RAISE EXCEPTION 'Missing trigger: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(rlsTables)}] LOOP\n    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=v_name AND c.relrowsecurity) THEN RAISE EXCEPTION 'RLS missing: %', v_name; END IF;\n  END LOOP;\n  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND p.proname IN (${sqlList(functions)}) AND coalesce(array_to_string(p.proconfig,','),'') NOT LIKE '%search_path=%') THEN RAISE EXCEPTION 'SECURITY DEFINER function lacks pinned search_path'; END IF;\n  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN (${sqlList(tables)}) AND grantee IN ('anon','authenticated') AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) THEN RAISE EXCEPTION 'Unexpected browser write privilege'; END IF;\n  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name IN (${sqlList(functions)}) AND grantee IN ('PUBLIC','anon','authenticated') AND privilege_type='EXECUTE') THEN RAISE EXCEPTION 'Unexpected function EXECUTE privilege'; END IF;\nEND;\n$$;\nSELECT schemaname, tablename, policyname, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN (${sqlList(rlsTables)}) ORDER BY tablename, policyname;\nSELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS signature, r.rolname AS owner, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.proname IN (${sqlList(functions)}) ORDER BY p.proname;\n`

const hardenedPreflight = preflight.replace(
  "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND contype='p') THEN RAISE EXCEPTION 'payments primary-key lifecycle assumption failed'; END IF;",
  `  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payments'::regclass AND contype='p') THEN RAISE EXCEPTION 'payments primary-key lifecycle assumption failed'; END IF;\n  IF current_user IN ('anon','authenticated','service_role') THEN RAISE EXCEPTION 'Migration owner must be a dedicated privileged owner, not an application role'; END IF;\n  IF to_regclass('public.payment_events') IS NULL OR to_regclass('public.ledger_entries') IS NULL THEN RAISE EXCEPTION 'Required lifecycle/legacy ledger relations are missing'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='gross_amount' AND data_type='numeric') THEN RAISE EXCEPTION 'payments.gross_amount numeric assumption failed'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='currency' AND data_type IN ('text','character varying','character')) THEN RAISE EXCEPTION 'payments.currency text assumption failed'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_events' AND column_name='raw_payload' AND data_type IN ('json','jsonb')) THEN RAISE EXCEPTION 'payment_events.raw_payload JSON assumption failed'; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='ledger_entries' AND i.indisunique AND i.indnatts=1 AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=c.oid AND attname='payment_id' AND NOT attisdropped)) THEN RAISE EXCEPTION 'legacy ledger_entries(payment_id) uniqueness assumption failed'; END IF;\n  IF EXISTS (SELECT 1 FROM (VALUES ('payment.reconciled'),('payment.pending'),('payment.processing'),('payment.confirmed'),('payment.failed'),('payment.canceled'),('payment.expired'),('payment.incomplete')) required(value) WHERE EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_events'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%payment.%' AND pg_get_constraintdef(oid) NOT LIKE ('%' || required.value || '%'))) THEN RAISE EXCEPTION 'payment_events event-type compatibility assumption failed'; END IF;`,
)

const hardenedPostflight = postflight.replace(
  "  IF EXISTS (SELECT 1 FROM pg_proc",
  `  FOREACH v_name IN ARRAY ARRAY[${sqlList(functionSignatures)}] LOOP\n    IF to_regprocedure('public.' || v_name) IS NULL THEN RAISE EXCEPTION 'Missing exact function signature: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(constraints)}] LOOP\n    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=v_name) THEN RAISE EXCEPTION 'Missing constraint: %', v_name; END IF;\n  END LOOP;\n  FOREACH v_name IN ARRAY ARRAY[${sqlList(forceRlsTables)}] LOOP\n    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=v_name AND c.relforcerowsecurity) THEN RAISE EXCEPTION 'FORCE RLS missing: %', v_name; END IF;\n  END LOOP;\n  IF to_regprocedure('public.consume_shift4_tokenization_session(uuid,uuid,text,text)') IS NULL THEN RAISE EXCEPTION 'Exact token-consumption RPC signature missing'; END IF;\n  IF to_regprocedure('public.create_shift4_onboarding_session(uuid,uuid,text,text,text,text,text)') IS NULL THEN RAISE EXCEPTION 'Exact onboarding-create RPC signature missing'; END IF;\n  IF to_regprocedure('public.apply_shift4_onboarding_update(uuid,text,text,text,text,timestamp with time zone,text,boolean,text)') IS NULL THEN RAISE EXCEPTION 'Exact onboarding-update RPC signature missing'; END IF;\n  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.proname IN (${sqlList(functions)}) AND r.rolname IN ('PUBLIC','anon','authenticated','service_role')) THEN RAISE EXCEPTION 'Release function has unsafe owner role'; END IF;\n  IF EXISTS (SELECT 1 FROM pg_proc`,
)

const smoke = `-- PineTree Shift4 transaction-contained synthetic smoke tests\n-- ${validationLabel}; PostgreSQL runtime status remains not_executed.\n-- Run with psql variables merchant_id, payment_id, connection_id referencing disposable synthetic parent rows.\nBEGIN;\nSET LOCAL statement_timeout = '30s';\nSET LOCAL lock_timeout = '5s';\nDO $$\nBEGIN\n  IF current_setting('transaction_read_only')::boolean THEN RAISE EXCEPTION 'Writable disposable transaction required'; END IF;\n  IF to_regclass('public.ledger_transactions') IS NULL OR to_regclass('public.shift4_payment_attempts') IS NULL THEN RAISE EXCEPTION 'Release objects missing'; END IF;\nEND;\n$$;\n-- S01 balanced journal: call post_ledger_transaction with equal integer debit/credit lines; assert one transaction and balanced entries.\n-- S02 unbalanced rejection: repeat with unequal totals inside an exception-catching DO block.\n-- S03 duplicate posting: repeat S01 with identical posting key and payload; assert same transaction identity.\n-- S04 conflicting posting key: repeat posting key with changed integer amount; assert rejection.\n-- S05 account mismatch: use an account owned by another synthetic merchant; assert rejection.\n-- S06 invalid lifecycle link: link a capture to a non-authorization parent; assert rejection.\n-- S07 cross-tenant attempt: call create_shift4_payment_attempt with mismatched merchant/payment; assert rejection.\n-- S08 attempt creation: create one synthetic authorization attempt and assert merchant/payment/invoice ownership.\n-- S09 partial approval: apply evidence with an approved amount below requested amount; assert remaining amount and PROCESSING.\n-- S10 first capture: create/capture first tender and assert canonical payment remains PROCESSING.\n-- S11 second capture: create/capture remaining tender and assert total exactly equals payment amount.\n-- S12 fee once: assert one fee journal posting across both tenders.\n-- S13 exact confirmation: assert payment becomes CONFIRMED only when captured total equals required total.\n-- S14 tokenization: create synthetic opaque fingerprint, consume once, then assert replay rejection without storing raw token.\n-- S15 onboarding: create synthetic session, apply one update, replay update_reference, and assert one append-only event.\n-- S16 append-only: attempt UPDATE/DELETE of journal and onboarding evidence and assert trigger rejection.\n-- Operator assertion queries (must all return zero rows):\nSELECT transaction_id FROM public.ledger_journal_entries GROUP BY transaction_id HAVING sum(CASE WHEN direction='debit' THEN amount_minor ELSE -amount_minor END) <> 0;\nSELECT payment_id FROM public.shift4_payment_attempts GROUP BY payment_id HAVING count(*) FILTER (WHERE fee_posted_at IS NOT NULL) > 1;\nSELECT token_fingerprint FROM public.shift4_tokenization_sessions GROUP BY token_fingerprint HAVING count(*) > 1;\nROLLBACK;\n`

const containment = `-- PineTree Shift4 containment; preserves financial and certification evidence.\n-- 1. Set every SHIFT4_* enablement flag false through controlled deployment configuration.\n-- 2. Stop new Shift4 checkout, POS, onboarding, and certification-fixture traffic.\n-- 3. Keep read-only invoice lookup/reconciliation available only under incident approval.\n-- 4. Do not DROP, TRUNCATE, DELETE, or rewrite attempts, tenders, journal, tokenization, onboarding, or evidence.\n-- 5. Verify production_processing readiness is blocked before resuming general traffic.\nSELECT state, recovery_state, count(*) FROM public.shift4_payment_attempts GROUP BY state, recovery_state ORDER BY state, recovery_state;\nSELECT status, count(*) FROM public.shift4_onboarding_sessions GROUP BY status ORDER BY status;\n`

const hardenedSmoke = smoke
  .replace(
    "SELECT transaction_id FROM public.ledger_journal_entries GROUP BY transaction_id HAVING sum(CASE WHEN direction='debit' THEN amount_minor ELSE -amount_minor END) <> 0;",
    "SELECT ledger_transaction_id FROM public.ledger_journal_entries GROUP BY ledger_transaction_id HAVING sum(CASE WHEN side='debit' THEN amount_minor ELSE -amount_minor END) <> 0;",
  )
  .replace(
    "SELECT payment_id FROM public.shift4_payment_attempts GROUP BY payment_id HAVING count(*) FILTER (WHERE fee_posted_at IS NOT NULL) > 1;",
    "SELECT l.payment_id FROM public.ledger_transactions t JOIN public.ledger_links l ON l.ledger_transaction_id=t.id WHERE t.event_type='shift4.platform_fee' AND l.link_type='payment' GROUP BY l.payment_id HAVING count(*) > 1;",
  )
  .replace(
    "SELECT token_fingerprint FROM public.shift4_tokenization_sessions GROUP BY token_fingerprint HAVING count(*) > 1;",
    "SELECT session_id FROM public.shift4_tokenization_sessions WHERE token_fingerprint IS NOT NULL AND token_fingerprint !~ '^[0-9a-f]{24}$';",
  )

const applyOrder = sourceRows.map(({ releaseEntry }) => `${releaseEntry.executionOrder}. ${releaseEntry.path}  SHA256=${releaseEntry.sha256}`).join("\n") + "\n"
const checklist = `# Shift4 database release operator checklist\n\n- [ ] Confirm an approved disposable/staging PostgreSQL target; never infer production authorization.\n- [ ] Verify all feature flags remain disabled.\n- [ ] Verify every migration SHA-256 against 00-manifest.json.\n- [ ] Run 01-preflight.sql read-only and resolve every exception.\n- [ ] Apply migrations exactly in 02-apply-order.txt order using the approved migration mechanism.\n- [ ] Run 03-postflight.sql and retain its complete output.\n- [ ] Prepare isolated synthetic parents and run 04-smoke-tests.sql; confirm final ROLLBACK.\n- [ ] Record runtime evidence separately; this repository package says not_executed.\n- [ ] If any gate fails, follow 05-containment.sql and preserve all evidence.\n- [ ] Enable no Shift4 traffic until provider credentials, certification, device, onboarding, and production gates are separately approved.\n`

const artifacts = {
  "00-manifest.json": JSON.stringify(manifest, null, 2) + "\n",
  "01-preflight.sql": hardenedPreflight,
  "02-apply-order.txt": applyOrder,
  "03-postflight.sql": hardenedPostflight,
  "04-smoke-tests.sql": hardenedSmoke,
  "05-containment.sql": containment,
  "06-operator-checklist.md": checklist,
}
const outputDirectory = resolve("artifacts", "shift4-database")
await mkdir(outputDirectory, { recursive: true })
for (const [name, content] of Object.entries(artifacts)) await writeFile(resolve(outputDirectory, name), content)

const artifactHashes = Object.fromEntries(Object.entries(artifacts).map(([name, content]) => [name, sha256(content)]))
console.log(JSON.stringify({ ok: true, validation: validationLabel, runtimeStatus: "not_executed", contactedDatabase: false, migrations: sourceRows.length, artifacts: Object.keys(artifacts).length, manifestSha256: artifactHashes["00-manifest.json"], artifactHashes }))
