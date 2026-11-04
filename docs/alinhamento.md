# Vértice — Documento de Alinhamento
Data: 04/11/2026
Referência de produto: Paperclip.ing (modelo empresa/equipe, não ferramenta técnica)

## 1. Decisões fechadas

### Produto e público
- Foco em **pessoas não técnicas**: linguagem de gestão (cargos, tarefas, aprovações),
  não de engenharia (runtimes, processos, stdout).
- Terminal vira **modo avançado** por agente, não a interface principal.
- Modelo mental: o usuário **gerencia uma equipe**, não opera CLIs.
- Cores do software: **azul e laranja** (azul = ações primárias/navegação;
  laranja = destaque, atividade e alertas). Tema base a validar no visual.

### Estrutura de navegação (inspirada no Paperclip)
1. **Agentes** — a equipe: cargos, estados, gestão (pausar, retomar, reatribuir, encerrar).
2. **Work** — issues e goals: tickets com dono, estado, histórico e vínculo com metas.
   Esta é a peça central do sistema; grafo e terminal são visualização/execução dela.
3. **Projects** — agrupamento do trabalho; cada projeto tem seu workspace e sua equipe.
4. **Organograma** — o canvas (React Flow) como UMA visão: hierarquia e conexões da equipe.
5. **Org** — configurações da "empresa": seletor de CLI, workspaces permitidos, políticas.

### Seletor de CLI (tela Org)
- Opções: Codex, Kimi, GLM, Claude (lista extensível por manifestos declarativos).
- Ao selecionar: verifica se a CLI está instalada.
- Se não estiver: **assistente de instalação dentro do app** (progresso, linguagem clara,
  validação final), executando os comandos pelo terminal embutido.
- O responsável de TI (você) aprova a lista de CLIs disponíveis e as políticas.
- Manifesto por CLI: comando de instalação, verificação, autenticação, início de sessão.

### Execução
- Sessões **vivas o tempo todo** (PTY persistente por agente), com opção de **pausar/retomar**.
- Heartbeats/agendamentos ficam como evolução futura, não no MVP.

### Distribuição e versionamento
- Git para **controle da ferramenta** (interno, sem dependência de nuvem externa).
- Distribuição aos funcionários via **intranet** da empresa.
- Backend local separado do frontend (mesma API pode virar serviço de rede depois).
- Persistência local em SQLite; segredos fora do banco e fora do frontend.
- Confinamento técnico ao workspace configurado, validado no backend (não no prompt).

## 2. O que muda em relação ao protótipo atual
- O canvas deixa de ser a tela principal → vira a visão "Organograma".
- Terminal deixa de ser o centro → vira painel avançado dentro de cada agente.
- Surgem as telas Work (issues/goals) e Projects — hoje inexistentes.
- Estados técnicos (working/idle) viram linguagem de trabalho ("Executando tarefa X",
  "Aguardando aprovação").
- Sidebar/inspector ganham verbos de gestor: Pausar, Retomar, Reatribuir, Encerrar.
- Runtimes deixam de ser fixos → detecção real + assistente de instalação na tela Org.

## 3. Próximos passos
1. Reorganizar o projeto: `app/` (frontend), `core/` (serviço local), `runtimes/` (manifestos).
2. Inicializar o repositório git interno com estrutura e commit inicial.
3. Reestruturar a navegação do frontend nas 5 seções (ainda com dados simulados).
4. Aplicar a identidade visual azul + laranja.
5. Só então começar o corte vertical real: detecção de CLI → agente → sessão → streaming.
