import test from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { flattenTextForPaste, formatTextForSession } from '../../app/src/lib/terminal-input.ts'

test('formatTextForSession envia exatamente um Enter no final (bracketed ou achatado)', () => {
  for (const bracketed of [true, false]) {
    const out = formatTextForSession('linha 1\r\nlinha 2\nlinha 3\n', bracketed)
    assert.equal(out.endsWith('\r'), true)
    assert.equal(out.split('\r').length - 1, 1)
    if (bracketed) {
      assert.equal(out, '\x1b[200~linha 1\nlinha 2\nlinha 3\x1b[201~\r')
    } else {
      assert.equal(out, 'linha 1 linha 2 linha 3\r')
      assert.equal(out.includes('\n'), false)
    }
  }
})

test('flattenTextForPaste normaliza quebras e preserva ordem das palavras', () => {
  const input = '\n  primeiro   bloco \r\n\r\n  segundo\tbloco \n terceiro \r\n'
  const out = flattenTextForPaste(input)
  assert.equal(out.includes('\n'), false)
  assert.equal(out.includes('\r'), false)
  assert.deepEqual(out.trim().split(/\s+/), input.trim().split(/\s+/))
})

test('Property 17: Um envio de texto contém exatamente um Enter', () => {
  // Feature: bloco-g-fechamento, Property 17: Um envio de texto contém exatamente um Enter
  fc.assert(
    fc.property(
      fc.string().map((s) => s.replace(/\r/g, '\n')),
      fc.boolean(),
      (text, bracketed) => {
        const out = formatTextForSession(text, bracketed)
        assert.equal(out.endsWith('\r'), true)
        assert.equal(out.split('\r').length - 1, 1)
        if (!bracketed) {
          assert.equal(out.slice(0, -1).includes('\n'), false)
        }
      },
    ),
    { numRuns: 100 },
  )
})

test('Property 18: O achatamento preserva as palavras na mesma ordem', () => {
  // Feature: bloco-g-fechamento, Property 18: O achatamento preserva as palavras na mesma ordem
  fc.assert(
    fc.property(
      fc.array(fc.stringMatching(/^[^\s\r\n]+$/), { minLength: 1, maxLength: 12 }),
      fc.array(fc.constantFrom(' ', '  ', '\n', '\r\n', '\t', '\n\n  '), { minLength: 1, maxLength: 12 }),
      (words, seps) => {
        let input = words[0]
        for (let i = 1; i < words.length; i += 1) {
          input += seps[i % seps.length] + words[i]
        }
        const out = formatTextForSession(input, false)
        const body = out.slice(0, -1)
        assert.deepEqual(body.split(/\s+/).filter(Boolean), words)
      },
    ),
    { numRuns: 100 },
  )
})
