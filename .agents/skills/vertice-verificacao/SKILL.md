---
name: vertice-verificacao
description: >-
  Use para verificar mudanças no Vértice antes de concluir ou commitar: build e lint do
  frontend, smoke test do serviço local (REST + WebSocket + sessão real), e teste visual
  no navegador com Chrome DevTools.
---

# Vértice — verificação

## 1. Frontend
```powershell
cd vertice\app
npm run build    # tsc -b + vite build — deve terminar sem erros
npm run lint
```

## 2. Serviço local
Inicie o core em segundo plano (`npm start` em `vertice\core`) e rode:
```powershell
powershell -ExecutionPolicy Bypass -File vertice\.agents\skills\vertice-verificacao\scripts\smoke-core.ps1
```
O script checa `/api/health`, lista runtimes detectados, abre uma sessão PowerShell real,
envia um comando, lê os eventos e encerra a sessão. Saída esperada: todos os passos `[OK]`.

## 3. Teste no navegador
Com core e app rodando (`npm run dev` → http://localhost:3000), use a skill
`chrome-devtools` (plugin já instalado) para:
- Abrir cada seção (Agentes, Work, Projects, Organograma, CLI's) e checar o console sem erros.
- Confirmar o rodapé "Serviço local conectado" e o banner online na página CLI's.
- Iniciar uma sessão real num agente e ver a saída no terminal do Organograma.
- Para acessibilidade/contraste das cores azul/laranja, a skill `a11y-debugging`.

## 4. Antes do commit
- [ ] Nada simulado aparece como real.
- [ ] `AGENTS.md` atualizado se o estado real/simulado mudou.
- [ ] `git status` sem `core/data/`, `node_modules/`, `dist/` ou logs.
- [ ] Mensagem em Conventional Commits.
