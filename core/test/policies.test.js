import { testDir, cleanup } from './helpers/env.js'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import fc from 'fast-check'
import {
  POLICY_KEYS,
  normalizePolicies,
  mergePolicyPatch,
  buildPolicyArgs,
  describePolicyEffects,
  buildPoliciesMarkdown,
  parsePoliciesMarkdown,
  buildPoliciesNote,
} from '../src/policies.js'
import { buildMemoryMarkdown } from '../src/agent-memory.js'
import { RUNTIME_CATALOG, validatePolicyFlags } from '../src/runtimes.js'
import { getPolicies, setSetting, listEvents } from '../src/db.js'

after(() => {
  cleanup()
})

test('normalizePolicies aplica falha fechada para valores ausentes, inválidos ou não-objetos', () => {
  for (const invalidInput of [undefined, null, false, true, 0, 123, 'true', [], new Date()]) {
    const out = normalizePolicies(invalidInput)
    assert.deepEqual(out.policies, {
      allowDestructiveCommands: false,
      allowNetwork: false,
      allowCredentials: false,
    })
    assert.deepEqual(out.invalid, [...POLICY_KEYS])
  }

  const partial = normalizePolicies({ allowNetwork: true, allowCredentials: 'sim' })
  assert.deepEqual(partial.policies, {
    allowDestructiveCommands: false,
    allowNetwork: true,
    allowCredentials: false,
  })
  assert.deepEqual(partial.invalid, ['allowDestructiveCommands', 'allowCredentials'])

  const valid = normalizePolicies({
    allowDestructiveCommands: false,
    allowNetwork: true,
    allowCredentials: false,
  })
  assert.deepEqual(valid.policies, {
    allowDestructiveCommands: false,
    allowNetwork: true,
    allowCredentials: false,
  })
  assert.deepEqual(valid.invalid, [])
})

test('Property 19: Política ausente ou inválida vale false', () => {
  // Feature: bloco-g-fechamento, Property 19: Política ausente ou inválida vale false
  const policyValueArb = fc.oneof(
    fc.boolean(),
    fc.constant(undefined),
    fc.constant(null),
    fc.integer(),
    fc.string(),
    fc.array(fc.boolean(), { maxLength: 3 }),
    fc.dictionary(fc.string({ maxLength: 8 }), fc.boolean(), { maxKeys: 2 }),
  )

  const partialObjectArb = fc.record(
    {
      allowDestructiveCommands: policyValueArb,
      allowNetwork: policyValueArb,
      allowCredentials: policyValueArb,
    },
    { requiredKeys: [] },
  )

  const rawArb = fc.oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.string(),
    fc.array(fc.anything(), { maxLength: 4 }),
    fc.date(),
    partialObjectArb,
  )

  fc.assert(
    fc.property(rawArb, (raw) => {
      const { policies, invalid } = normalizePolicies(raw)
      const isPlain = Boolean(
        raw
        && typeof raw === 'object'
        && !Array.isArray(raw)
        && (Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null),
      )

      assert.deepEqual(Object.keys(policies), POLICY_KEYS)
      for (const key of POLICY_KEYS) {
        assert.equal(typeof policies[key], 'boolean')
        if (!isPlain) {
          assert.equal(policies[key], false)
          assert.equal(invalid.includes(key), true)
        } else {
          const original = Object.hasOwn(raw, key) ? raw[key] : undefined
          assert.equal(policies[key], original === true)
          assert.equal(invalid.includes(key), typeof original !== 'boolean')
        }
      }
    }),
    { numRuns: 100 },
  )
})

test('mergePolicyPatch valida chaves, booleanos e preserva chaves não enviadas', () => {
  const current = {
    allowDestructiveCommands: false,
    allowNetwork: true,
    allowCredentials: false,
  }

  assert.deepEqual(mergePolicyPatch(current, { allowNetwork: false }), {
    policies: {
      allowDestructiveCommands: false,
      allowNetwork: false,
      allowCredentials: false,
    },
  })

  for (const badPatch of [null, undefined, [], 'str', 1, new Date()]) {
    const out = mergePolicyPatch(current, badPatch)
    assert.equal(typeof out.error, 'string')
    assert.equal(out.policies, undefined)
  }

  for (const badField of [
    { unknownPolicy: true },
    JSON.parse('{"__proto__": {"admin": true}}'),
    { allowNetwork: 'false' },
    { allowNetwork: 1 },
    { allowCredentials: null },
  ]) {
    const out = mergePolicyPatch(current, badField)
    assert.equal(typeof out.error, 'string')
    assert.equal(out.policies, undefined)
  }
})

test('Property 20: A seção "Políticas do setor" reflete exatamente o estado', () => {
  // Feature: bloco-g-fechamento, Property 20: A seção "Políticas do setor" reflete exatamente o estado
  const policiesArb = fc.record({
    allowDestructiveCommands: fc.boolean(),
    allowNetwork: fc.boolean(),
    allowCredentials: fc.boolean(),
  })

  fc.assert(
    fc.property(
      policiesArb,
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.string({ maxLength: 60 }),
      (policies, name, prompt) => {
        const expected = { ...policies }
        const section = buildPoliciesMarkdown(policies)
        assert.ok(section.startsWith('## Políticas do setor\n'))
        assert.match(section, /aplicação técnica depende do runtime/i)
        assert.deepEqual(parsePoliciesMarkdown(section), expected)

        const memoryMd = buildMemoryMarkdown({
          agent: { id: 'ag-prop', name, role: 'Especialista', prompt },
          memory: '',
          transcript: '',
          allAgents: [],
          connections: [],
          policies,
        })
        assert.ok(memoryMd.includes('## Políticas do setor'))
        assert.deepEqual(parsePoliciesMarkdown(memoryMd), expected)
      },
    ),
    { numRuns: 100 },
  )

  const defaultFailClosed = buildMemoryMarkdown({
    agent: { id: 'ag-default', name: 'Agente', role: 'Dev', prompt: '' },
  })
  assert.deepEqual(parsePoliciesMarkdown(defaultFailClosed), {
    allowDestructiveCommands: false,
    allowNetwork: false,
    allowCredentials: false,
  })
})

test('Property 21: As flags de política aparecem se e somente se a política está desligada e declarada', () => {
  // Feature: bloco-g-fechamento, Property 21: As flags de política aparecem se e somente se a política está desligada e declarada
  const policiesArb = fc.record({
    allowDestructiveCommands: fc.boolean(),
    allowNetwork: fc.boolean(),
    allowCredentials: fc.boolean(),
  })

  const flagEntryArb = (key) => fc.record({
    whenOff: fc.constant([`--flag-${key}`, `val-${key}`]),
    effect: fc.constantFrom('technical', 'directive', undefined),
    source: fc.constant(`https://docs.example.com/${key}`),
  })

  const runtimeArb = fc.record({
    id: fc.constantFrom('custom-a', 'custom-b'),
    policyFlags: fc.oneof(
      fc.constant(null),
      fc.record(
        {
          allowDestructiveCommands: flagEntryArb('allowDestructiveCommands'),
          allowNetwork: flagEntryArb('allowNetwork'),
          allowCredentials: flagEntryArb('allowCredentials'),
        },
        { requiredKeys: [] },
      ),
    ),
  })

  fc.assert(
    fc.property(runtimeArb, policiesArb, (runtime, policies) => {
      const args = buildPolicyArgs(runtime, policies)
      const effects = describePolicyEffects(runtime)

      for (const key of POLICY_KEYS) {
        const declared = runtime.policyFlags?.[key]
        const expectedFlag = `--flag-${key}`
        const shouldInclude = policies[key] === false && Boolean(declared?.whenOff?.length)
        assert.equal(args.includes(expectedFlag), shouldInclude)

        const expectedKind = declared?.effect === 'technical' ? 'technical' : 'directive'
        assert.equal(effects[key].kind, expectedKind)
        assert.equal(typeof effects[key].note, 'string')
        assert.ok(effects[key].note.length > 0)
      }
    }),
    { numRuns: 100 },
  )

  // Verifica também os manifestos reais de codex, claude e demais runtimes
  const codex = RUNTIME_CATALOG.find((r) => r.id === 'codex')
  const claude = RUNTIME_CATALOG.find((r) => r.id === 'claude')
  assert.ok(codex && claude)

  assert.deepEqual(
    buildPolicyArgs(codex, { allowDestructiveCommands: false, allowNetwork: false, allowCredentials: false }),
    ['--sandbox', 'workspace-write'],
  )
  assert.deepEqual(
    buildPolicyArgs(codex, { allowDestructiveCommands: false, allowNetwork: true, allowCredentials: false }),
    [],
  )
  assert.equal(codex.policyEffects.allowNetwork.kind, 'technical')
  assert.match(codex.policyEffects.allowNetwork.note, /sandbox/i)
  assert.match(codex.policyEffects.allowNetwork.note, /workspace/i)
  assert.equal(codex.policyEffects.allowDestructiveCommands.kind, 'directive')
  assert.equal(codex.policyEffects.allowCredentials.kind, 'directive')

  assert.deepEqual(
    buildPolicyArgs(claude, { allowDestructiveCommands: false, allowNetwork: false, allowCredentials: false }),
    ['--disallowedTools', 'WebFetch', 'WebSearch'],
  )
  assert.deepEqual(
    buildPolicyArgs(claude, { allowDestructiveCommands: false, allowNetwork: true, allowCredentials: false }),
    [],
  )
  assert.equal(claude.policyEffects.allowNetwork.kind, 'directive')
  assert.match(claude.policyEffects.allowNetwork.note, /WebFetch/)
  assert.match(claude.policyEffects.allowNetwork.note, /WebSearch/)
  assert.match(claude.policyEffects.allowNetwork.note, /shell/i)

  for (const id of ['kimi', 'glm', 'antigravity', 'opencode', 'ollama', 'lmstudio', 'powershell']) {
    const rt = RUNTIME_CATALOG.find((r) => r.id === id)
    assert.ok(rt)
    assert.deepEqual(buildPolicyArgs(rt, { allowDestructiveCommands: false, allowNetwork: false, allowCredentials: false }), [])
    for (const key of POLICY_KEYS) {
      assert.equal(rt.policyEffects[key].kind, 'directive')
    }
  }
})

test('Property 22: A nota de políticas do despacho lista exatamente as desligadas', () => {
  // Feature: bloco-g-fechamento, Property 22: A nota de políticas do despacho lista exatamente as desligadas
  const policiesArb = fc.record({
    allowDestructiveCommands: fc.boolean(),
    allowNetwork: fc.boolean(),
    allowCredentials: fc.boolean(),
  })

  const tokens = {
    allowDestructiveCommands: 'comandos destrutivos',
    allowNetwork: 'acesso à rede',
    allowCredentials: 'uso de credenciais',
  }

  fc.assert(
    fc.property(policiesArb, (policies) => {
      const note = buildPoliciesNote(policies)
      assert.equal(note.includes('\n'), false)
      assert.equal(note.includes('\r'), false)

      if (policies.allowDestructiveCommands && policies.allowNetwork && policies.allowCredentials) {
        assert.equal(note, '')
        return
      }

      assert.ok(note.length > 0)
      for (const key of POLICY_KEYS) {
        assert.equal(note.includes(tokens[key]), policies[key] === false)
      }
    }),
    { numRuns: 100 },
  )
})

test('validatePolicyFlags valida entradas e ignora inválidas com console.warn sem derrubar catálogo', () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    assert.equal(validatePolicyFlags(null), null)
    assert.equal(validatePolicyFlags('invalido'), null)
    assert.equal(validatePolicyFlags([]), null)

    const mixed = validatePolicyFlags({
      allowNetwork: {
        whenOff: ['--sandbox', 'workspace-write'],
        effect: 'technical',
        source: 'https://developers.openai.com/codex/sandbox',
      },
      allowCredentials: {
        whenOff: ['--no-creds'],
        effect: 'directive',
        source: 'http://inseguro.example.com',
      },
      allowDestructiveCommands: {
        whenOff: ['   '],
        effect: 'magic',
        source: 'https://example.com',
      },
      desconhecida: {
        whenOff: ['--x'],
        effect: 'directive',
        source: 'https://example.com',
      },
    })

    assert.deepEqual(mixed, {
      allowNetwork: {
        whenOff: ['--sandbox', 'workspace-write'],
        effect: 'technical',
        source: 'https://developers.openai.com/codex/sandbox',
      },
    })
    assert.ok(warnings.length >= 4)
  } finally {
    console.warn = origWarn
  }
})

test('getPolicies falha fechado e registra evento de sistema quando ausente ou corrompido no SQLite', () => {
  const initial = getPolicies()
  assert.deepEqual(initial, {
    allowDestructiveCommands: false,
    allowNetwork: true,
    allowCredentials: false,
  })

  const dbFile = join(testDir, 'data', 'vertice.db')
  const raw = new DatabaseSync(dbFile)
  try {
    // Corrompe com JSON inválido
    raw.prepare("UPDATE settings SET value = 'corrompido' WHERE key = 'policies'").run()
    const beforeCorruptId = listEvents()[0]?.id ?? 0
    assert.deepEqual(getPolicies({ recordOnInvalid: false }), {
      allowDestructiveCommands: false,
      allowNetwork: false,
      allowCredentials: false,
    })
    assert.equal(listEvents()[0]?.id ?? 0, beforeCorruptId)

    assert.deepEqual(getPolicies(), {
      allowDestructiveCommands: false,
      allowNetwork: false,
      allowCredentials: false,
    })
    const eventsAfterCorrupt = listEvents()
    assert.ok(eventsAfterCorrupt[0].id > beforeCorruptId)
    assert.match(eventsAfterCorrupt[0].message, /Política ausente ou inválida tratada como desligada/)

    // Remove a linha de settings.policies
    raw.prepare("DELETE FROM settings WHERE key = 'policies'").run()
    const beforeMissingId = listEvents()[0]?.id ?? 0
    assert.deepEqual(getPolicies(), {
      allowDestructiveCommands: false,
      allowNetwork: false,
      allowCredentials: false,
    })
    const eventsAfterMissing = listEvents()
    assert.ok(eventsAfterMissing[0].id > beforeMissingId)
    assert.match(eventsAfterMissing[0].message, /allowDestructiveCommands, allowNetwork, allowCredentials/)
  } finally {
    raw.close()
    setSetting('policies', initial)
  }
})
