# Manifestos de Runtimes (Vértice)

Catálogo declarativo das CLIs/runtimes suportados. O `core/src/runtimes.js`
lê todos os `*.json` desta pasta no boot e monta o `RUNTIME_CATALOG`.

**Adicionar uma nova CLI = criar um arquivo `<id>.json` aqui.** Não é preciso
editar código: reinicie o `vertice-core` e o runtime passa a ser detectado.

## Esquema

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `id` | string | sim | Identificador único (usado nas rotas e no SQLite). |
| `name` | string | sim | Nome exibido na UI. |
| `kind` | string | sim | Categoria: `CLI de IA`, `Modelo local` ou `Shell`. |
| `command` | string | sim | Executável procurado no PATH (via `where`). |
| `versionArgs` | string[] | sim | Argumentos para obter a versão (ex.: `["--version"]`). |
| `sessionArgs` | string[] | sim | Argumentos ao abrir uma sessão interativa. |
| `install` | string\|null | não | Comando oficial de instalação (ou `null` se não aplicável). |
| `http` | string\|null | não | URL de verificação para serviços locais (Ollama/LM Studio). |
| `authenticates` | boolean | não | `true` se a CLI exige login antes de rodar (relevante para execução não interativa). |
| `authCheck` | objeto\|null | não | Onde a CLI guarda o login: `{ "files": ["%USERPROFILE%\\..."], "env": ["VAR"] }`. A aba CLI's mostra "Credencial encontrada" se algum arquivo existir ou alguma variável estiver definida (não valida o token). Sem `authCheck`, o estado do login aparece como "não dá para verificar daqui". |
| `headless` | objeto\|null | não | Configuração opcional de execução não interativa estruturada (ver seção abaixo). Quando ausente ou inválido, o runtime permanece exclusivamente interativo. |
| `policyFlags` | objeto\|null | não | Flags oficiais aplicadas quando uma política do setor está desligada (`false`). Ver seção abaixo. |
| `order` | number | não | Ordem de exibição no catálogo (menor primeiro). Padrão: 999. |

## Modo headless (opcional)

O campo `headless` habilita a execução automática sem terminal para tarefas marcadas pelo gestor.

| Subcampo | Tipo | Obrigatório | Regra de validação |
|---|---|---|---|
| `args` | string[] | sim | Lista de argumentos constantes (cada item deve ser uma string não vazia). |
| `prompt` | `"stdin"` | sim | Deve ser exatamente `"stdin"`. |
| `output` | `"claude-json" \| "text"` | sim | Formato esperado no `stdout`: objeto JSON do Claude (`result`) ou texto plano. |
| `timeoutMs` | number | sim | Inteiro em milissegundos entre `60000` (1 min) e `3600000` (60 min). |
| `sources` | string[] | sim | URLs da documentação oficial que embasam as flags; deve conter ao menos uma URL iniciando com `https://`. |

### Regra de segurança: o prompt só vai por stdin

**O prompt só vai por stdin — nunca nos `args` e nunca em linha de comando de shell.**
No Windows, executáveis `.cmd` / `.bat` (como shims do `npm`) precisam ser iniciados via `cmd.exe /c`, onde metacaracteres como `&`, `|`, `>`, `^` e `%` em argumentos seriam interpretados pelo shell. Por isso, o esquema aceita exclusivamente `"prompt": "stdin"` e o validador (`validateHeadlessBlock`) descarta qualquer bloco fora desse contrato, mantendo os argumentos fixos e constantes no manifesto.

### Decisões por runtime

| Runtime | Possui `headless`? | Motivo |
|---|---|---|
| `claude` | Sim | Flags oficiais (`-p --output-format json --permission-mode acceptEdits`), saída JSON estruturada (`result`) e prompt por stdin confirmados; `acceptEdits` restringe aprovação automática a edições na pasta do projeto. |
| `codex` | Sim | Subcomando oficial `exec --sandbox workspace-write --skip-git-repo-check -`, leitura de prompt por stdin (`-`), saída textual limpa em `stdout` e sandbox do SO confirmados. |
| `kimi` | Não (interativo) | Embora documente `--print --final-message-only` com stdin, o `--print` ativa `--afk` e auto-aprova todas as chamadas de ferramenta sem gating técnico; no modo interativo o Kimi pede aprovação e o monitor aguarda o gestor. |
| `glm` | Não (interativo) | Flag `--prompt` documentada apenas em README de projeto de terceiros (não oficial), sem documentação de formato de saída ou códigos de saída e sem suporte confirmado a stdin. |
| `antigravity` | Não (interativo) | Prompt documentado apenas como argumento de linha de comando (não por stdin), ações sem aprovação são negadas silenciosamente com código de saída `0` e há relato de saída vazia fora de terminal real. |
| `opencode` | Não (interativo) | `opencode run` documenta a mensagem como argumento de linha de comando (não por stdin) e não detalha formato JSON e códigos de saída nas páginas consultadas. |
| `ollama`, `lmstudio`, `powershell` | Não (interativos) | Não são CLIs de agente com modo `print` estruturado. |

## Políticas do setor (`policyFlags` e `policyEffects`)

O campo opcional `policyFlags` declara quais flags oficiais da CLI são acrescentadas quando uma das políticas do setor (`allowDestructiveCommands`, `allowNetwork`, `allowCredentials`) está desligada (`false`).

| Subcampo (por chave de política) | Tipo | Obrigatório | Regra de validação |
|---|---|---|---|
| `whenOff` | string[] | sim | Lista não vazia de flags constantes (strings não vazias) passadas quando a política é `false`. |
| `effect` | `"technical" \| "directive"` | sim | Classificação honesta do efeito real da flag. |
| `source` | string | sim | URL da documentação oficial iniciando com `https://`. |

### Efeito efetivo (`policyEffects`)

A partir de `policyFlags`, `core/src/runtimes.js` calcula `policyEffects` (via `describePolicyEffects(runtime)`) e o expõe em `RUNTIME_CATALOG`, `GET /api/catalog` e `GET /api/runtimes`:

- `kind: "technical"` (**Bloqueio técnico**): somente quando `effect === "technical"` está declarado no manifesto (ex.: `codex` com `allowNetwork: false` aplica `--sandbox workspace-write`, que bloqueia rede no sandbox do SO e limita escrita ao workspace).
- `kind: "directive"` (**Diretiva**): qualquer política sem flag oficial ou com bloqueio apenas parcial. No `claude`, `allowNetwork: false` aplica `--disallowedTools WebFetch WebSearch` (conferido na documentação oficial e em `claude --help`), bloqueando as ferramentas web nativas, mas comandos de shell ainda podem acessar a rede — por isso é classificada como `directive`.
- `allowDestructiveCommands` e `allowCredentials` (em todos os runtimes) e todas as políticas dos demais runtimes (`kimi`, `glm`, `antigravity`, `opencode`, `ollama`, `lmstudio`, `powershell`) não possuem flag oficial confirmada e valem como diretiva registrada na memória viva (`.vertice/memory/<agente>.md`) e na instrução da tarefa.

## Observações

- Manifestos malformados (JSON inválido ou faltando campos obrigatórios) são
  ignorados com aviso no log; a detecção continua com os válidos.
- Blocos `headless` ou entradas de `policyFlags` inválidos são ignorados com
  aviso (`console.warn`) no boot, sem derrubar o catálogo: o runtime continua
  disponível no modo interativo / com políticas em modo diretiva.
- Se a pasta estiver ausente ou vazia, o `runtimes.js` usa um catálogo embutido
  de fallback para nunca quebrar a detecção.
- A instalação só executa o comando oficial do campo `install`, nunca entrada
  arbitrária do usuário (ver `POST /api/runtimes/:id/install`).
