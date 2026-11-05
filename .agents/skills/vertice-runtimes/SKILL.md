---
name: vertice-runtimes
description: >-
  Use ao adicionar, detectar, instalar ou iniciar CLIs de IA e modelos locais no Vértice
  (Claude Code, Codex, Kimi, GLM/Z.ai, Antigravity, OpenCode, Ollama, LM Studio,
  PowerShell), ao criar manifestos em vertice/runtimes/, ou ao depurar spawn de
  processos e node-pty no Windows.
---

# Vértice — runtimes e CLIs

## Onde está
- Catálogo: `core/src/runtimes.js` → `RUNTIME_CATALOG`.
- Sessões: `core/src/sessions.js` → `startSession()`.
- Mapeamento nome → id no frontend: `RUNTIME_NAME_TO_ID` em `app/src/store/workspace.tsx`
  (manter em sincronia ao adicionar runtime; ideal futuro: usar `/api/catalog`).

## Campos de uma entrada do catálogo
```js
{ id, name, kind: 'CLI de IA' | 'Modelo local' | 'Shell',
  command,          // nome no PATH
  versionArgs,      // ex.: ['--version']
  sessionArgs,      // args da sessão interativa
  http?,            // endpoint de saúde (modelos locais rodando como serviço)
  install }         // comando de instalação ou null (= manual)
```

## Adicionar uma CLI
1. **Pesquise** o nome do pacote/comando oficial e o comando de instalação no Windows
   (npm global, winget ou script oficial). Não invente pacotes.
2. Adicione a entrada em `RUNTIME_CATALOG` e em `RUNTIME_NAME_TO_ID`.
3. Se for opção da criação de agente, inclua-a no select de `app/src/components/AgentDialogs.tsx`.
4. Verifique: `Invoke-RestMethod http://localhost:7845/api/runtimes | % runtimes | ft id,status,version`.

## Peculiaridades do Windows (já resolvidas — não regredir)
- `where <cmd>` pode devolver um shim sem extensão (script bash do npm) **antes** do `.cmd`.
  `resolveCommand()` prioriza `.exe/.cmd/.bat`.
- `node-pty` (CreateProcess) **não executa `.cmd/.bat` diretamente** → embrulhar em
  `cmd.exe /c <arquivo.cmd> ...args`.
- Sem `node-pty`, cai para `child_process.spawn` com pipes e `shell: true` (sem TTY real:
  CLIs interativas podem não renderizar). Sempre informar o `mode` (`pty`/`pipe`) na UI.
- `node-pty` é `optionalDependency` e nativo: precisa de binário pré-compilado compatível
  com a versão do Node; se falhar, `npm rebuild node-pty` (requer Build Tools do VS).
- PATH atualizado após instalar CLI **não** é visto pelo processo `core` já aberto:
  ao final da instalação, reler o PATH do registro ou orientar reinício do serviço.

## Detecção honesta
- Status só é `installed` se `where` encontrou o comando **ou** o `http` respondeu.
- Nunca marcar um runtime como conectado/autenticado sem verificação real.
- Autenticação (login das CLIs) é etapa separada — futura entrada `auth` no manifesto.

## Instalação (estado atual e alvo)
- **Hoje:** o frontend abre uma sessão PowerShell e digita `install` (`installCliReal`).
- **Alvo:** endpoint `POST /api/runtimes/:id/install` no core, que executa **apenas** o
  comando do catálogo/manifesto aprovado pelo TI, transmite progresso por WS e revalida
  ao final. O frontend não deve enviar comandos arbitrários de instalação.

## Manifestos declarativos (roadmap)
Migrar `RUNTIME_CATALOG` para `vertice/runtimes/<id>.json` com os mesmos campos +
`auth`, `approved`, `minVersion`. Carregar no boot do core e validar o esquema.
