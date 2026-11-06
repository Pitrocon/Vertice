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
| `order` | number | não | Ordem de exibição no catálogo (menor primeiro). Padrão: 999. |

## Observações

- Manifestos malformados (JSON inválido ou faltando campos obrigatórios) são
  ignorados com aviso no log; a detecção continua com os válidos.
- Se a pasta estiver ausente ou vazia, o `runtimes.js` usa um catálogo embutido
  de fallback para nunca quebrar a detecção.
- A instalação só executa o comando oficial do campo `install`, nunca entrada
  arbitrária do usuário (ver `POST /api/runtimes/:id/install`).
