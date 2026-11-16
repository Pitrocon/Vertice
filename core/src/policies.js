export const POLICY_KEYS = ['allowDestructiveCommands', 'allowNetwork', 'allowCredentials']

const POLICY_LABELS = {
  allowDestructiveCommands: 'Comandos destrutivos',
  allowNetwork: 'Acesso à rede',
  allowCredentials: 'Uso de credenciais',
}

const POLICY_OFF_NOTES = {
  allowDestructiveCommands: 'comandos destrutivos não permitidos',
  allowNetwork: 'acesso à rede não permitido',
  allowCredentials: 'uso de credenciais não permitido',
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Normaliza `settings.policies` com falha fechada: cada política só é `true`
 * quando `raw` é objeto plano e `raw[chave] === true`. Chaves ausentes ou
 * não booleanas viram `false` e entram em `invalid`.
 */
export function normalizePolicies(raw) {
  if (!isPlainObject(raw)) {
    return {
      policies: {
        allowDestructiveCommands: false,
        allowNetwork: false,
        allowCredentials: false,
      },
      invalid: [...POLICY_KEYS],
    }
  }

  const policies = {}
  const invalid = []
  for (const key of POLICY_KEYS) {
    const val = Object.hasOwn(raw, key) ? raw[key] : undefined
    if (typeof val === 'boolean') {
      policies[key] = val
    } else {
      policies[key] = false
      invalid.push(key)
    }
  }
  return { policies, invalid }
}

/**
 * Mescla uma atualização parcial de políticas sobre o estado atual.
 * Recusa objetos não planos, chaves desconhecidas e valores não booleanos.
 */
export function mergePolicyPatch(current, patch) {
  if (!isPlainObject(patch)) {
    return { error: 'policies deve ser um objeto válido.' }
  }

  const base = normalizePolicies(current).policies
  const next = { ...base }

  for (const key of Object.keys(patch)) {
    if (!POLICY_KEYS.includes(key)) {
      return { error: `Política desconhecida: ${key}` }
    }
    if (typeof patch[key] !== 'boolean') {
      return { error: `A política "${key}" deve ser booleana.` }
    }
    next[key] = patch[key]
  }

  return { policies: next }
}

/**
 * Concatena, na ordem de `POLICY_KEYS`, as flags declaradas no manifesto para
 * cada política que estiver desligada (`false`).
 */
export function buildPolicyArgs(runtime, policies) {
  const flagsConfig = runtime?.policyFlags
  if (!flagsConfig || typeof flagsConfig !== 'object') return []
  const normalized = normalizePolicies(policies).policies
  const args = []
  for (const key of POLICY_KEYS) {
    if (normalized[key] !== false) continue
    const whenOff = flagsConfig[key]?.whenOff
    if (!Array.isArray(whenOff)) continue
    for (const flag of whenOff) {
      if (typeof flag === 'string' && flag.trim().length > 0) {
        args.push(flag)
      }
    }
  }
  return args
}

/**
 * Descreve o efeito real de cada política para um runtime:
 * `technical` somente quando declarado explicitamente no manifesto;
 * `directive` em todos os demais casos.
 */
export function describePolicyEffects(runtime) {
  const flagsConfig = isPlainObject(runtime?.policyFlags) ? runtime.policyFlags : null
  const effects = {}

  for (const key of POLICY_KEYS) {
    const spec = flagsConfig && isPlainObject(flagsConfig[key]) ? flagsConfig[key] : null
    const kind = spec?.effect === 'technical' ? 'technical' : 'directive'

    let note
    if (kind === 'technical') {
      if (key === 'allowNetwork' && (runtime?.id === 'codex' || (Array.isArray(spec.whenOff) && spec.whenOff.includes('--sandbox')))) {
        note = 'Bloqueio técnico: executa em sandbox sem acesso à rede e com escrita limitada ao workspace.'
      } else {
        note = 'Bloqueio técnico aplicado por flag oficial do runtime.'
      }
    } else if (spec && Array.isArray(spec.whenOff) && spec.whenOff.length > 0) {
      if (key === 'allowNetwork' && (runtime?.id === 'claude' || spec.whenOff.includes('WebFetch') || spec.whenOff.includes('WebSearch'))) {
        note = 'Diretiva com bloqueio parcial: desabilita as ferramentas web (WebFetch/WebSearch), mas comandos no shell ainda podem acessar a rede.'
      } else {
        note = 'Diretiva com flag parcial do runtime; registrada na memória viva e na instrução da tarefa.'
      }
    } else {
      note = 'Diretiva: registrada na memória viva e na instrução da tarefa (sem bloqueio técnico neste runtime).'
    }

    const entry = { kind, note }
    if (typeof spec?.source === 'string' && spec.source.trim().length > 0) {
      entry.source = spec.source
    }
    effects[key] = entry
  }

  return effects
}

/**
 * Gera a seção "## Políticas do setor" para a memória viva dos agentes.
 */
export function buildPoliciesMarkdown(policies) {
  const normalized = normalizePolicies(policies).policies
  return [
    '## Políticas do setor',
    ...POLICY_KEYS.map(
      (key) => `- ${POLICY_LABELS[key]} (\`${key}\`): ${normalized[key] ? 'permitido' : 'NÃO permitido'}`,
    ),
    '',
    'A aplicação técnica depende do runtime; quando não houver bloqueio técnico no runtime, estas políticas valem como diretiva operacional.',
  ].join('\n')
}

/**
 * Lê de volta o estado booleano das políticas a partir da seção "## Políticas do setor".
 */
export function parsePoliciesMarkdown(markdown) {
  const text = String(markdown ?? '')
  const sectionMatch = text.match(/(?:^|\n)## Políticas do setor\n([\s\S]*?)(?:\n## |\s*$)/)
  const section = sectionMatch ? sectionMatch[1] : ''
  if (!section) return null
  const out = {}
  for (const key of POLICY_KEYS) {
    const match = section.match(new RegExp(`^- .+\\(\`${key}\`\\):\\s*(NÃO permitido|permitido)\\s*$`, 'm'))
    if (!match) return null
    out[key] = match[1] === 'permitido'
  }
  return out
}

/**
 * Gera uma linha concisa apenas com as políticas desligadas (`false`).
 * Retorna string vazia quando todas estão ligadas (`true`).
 */
export function buildPoliciesNote(policies) {
  const normalized = normalizePolicies(policies).policies
  const disabled = POLICY_KEYS
    .filter((key) => normalized[key] === false)
    .map((key) => POLICY_OFF_NOTES[key])
  if (disabled.length === 0) return ''
  return `Políticas do setor (restrições ativas): ${disabled.join('; ')}.`
}
