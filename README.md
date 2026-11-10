# Vértice — Sistema Operacional Local de Agentes de IA

O **Vértice** é uma plataforma desktop para Windows que permite a qualquer colaborador — técnico ou não — **montar, coordenar e supervisionar uma equipe de agentes de IA** trabalhando em conjunto dentro de pastas reais do seu computador, através de uma interface visual simples e organizada.

---

## 🎯 Qual é a proposta do Vértice?

Trabalhar com agentes de IA via linha de comando (como *Claude Code*, *Codex CLI*, *Kimi CLI*, *Antigravity CLI*, *Ollama*, entre outros) costuma exigir conhecimento técnico de terminal, repetição manual de prompts e perda de contexto toda vez que a janela é fechada.

O **Vértice** resolve isso transformando essas ferramentas em uma **equipe visual e persistente**:

1. **Equipe de IA em formato de Organograma:** Você cria agentes com cargos, responsabilidades e instruções claras (ex.: *Gerente*, *Pesquisador*, *Desenvolvedor*, *Revisor*, *Tester*) e define quem responde a quem.
2. **Quadro de Tarefas com Execução e Revisão Automática (`Work`):** Quando uma tarefa é movida para **Em andamento**, o Vértice aciona o agente responsável no terminal real. Assim que a IA termina o trabalho, o card é movido **automaticamente** para **Aguardando aprovação**, exibindo o resumo do que foi entregue para validação humana.
3. **Memória Viva entre Sessões:** Seus agentes **não esquecem o contexto** quando você fecha o programa ou reinicia o computador. O Vértice salva continuamente a conversa limpa e o histórico de entregas de cada agente no banco local e em `.vertice/memory/<agente>.md`, retomando o contexto automaticamente na sessão seguinte.
4. **Biblioteca de Prompts Reutilizáveis:** Salve seus melhores prompts de sistema na biblioteca interna para criar ou ajustar novos agentes com apenas 1 clique.
5. **Segurança e Confinamento Local (`CLI's`):** Os agentes operam **exclusivamente dentro da pasta do projeto ativo** (pastas sensíveis do Windows e de outros usuários são bloqueadas) e só utilizam as ferramentas de IA aprovadas na aba **CLI's**.

---

## 💿 Como Instalar (Para Usuários)

1. Acesse a aba [**Releases**](https://github.com/Pitrocon/Vertice/releases) deste repositório no GitHub e baixe o instalador **`Vertice-Setup-0.1.0.exe`**.
2. Dê dois cliques em **`Vertice-Setup-0.1.0.exe`**.
   > **Nota sobre o Windows SmartScreen:** Como o instalador ainda não possui assinatura digital comercial da Microsoft, o Windows pode exibir a janela *"O Windows protegeu o computador"*. Basta clicar em **Mais informações** e depois em **Executar assim mesmo**.
3. Escolha a pasta de instalação (ou mantenha a padrão) e conclua. O Vértice criará um atalho na sua **Área de Trabalho** e no **Menu Iniciar**.

*(Você não precisa instalar Node.js nem configurar servidor manualmente — o serviço local já vem embutido dentro do aplicativo).*

---

## 🚀 Como Usar o Vértice (Passo a Passo)

Ao abrir o Vértice pela primeira vez, siga estes **5 passos** para colocar sua equipe de IA para trabalhar:

### 1️⃣ Verifique e aprove sua ferramenta de IA (Aba `CLI's`)
No menu lateral esquerdo, clique em **`CLI's`**:
- O Vértice detecta automaticamente quais ferramentas de IA já estão instaladas no seu Windows (*Claude Code*, *Codex CLI*, *Kimi CLI*, *GLM CLI*, *Antigravity CLI*, *OpenCode*, *Ollama*, *LM Studio* e *PowerShell*).
- Se precisar instalar alguma delas, clique em **Instalar via terminal**.
- Certifique-se de que a ferramenta que você deseja usar esteja marcada como **Aprovada** (chave ativa) — por segurança, os agentes só podem usar runtimes aprovados.

---

### 2️⃣ Crie o seu Projeto (Aba `Projects`)
Antes de iniciar qualquer agente, defina em qual pasta do computador a equipe vai trabalhar:
1. Vá até a aba **`Projects`** e clique em **`+ Novo projeto`**.
2. Informe:
   - **Nome:** ex.: `Automação Comercial` ou `Projeto Teste`.
   - **Workspace (Pasta):** o caminho da pasta dedicada ao projeto (ex.: `%USERPROFILE%\vertice-workspaces\meu-projeto` ou `C:\Users\seu-usuario\Desktop\MeuProjeto`).
   - **Descrição:** resumo do objetivo daquele projeto.
3. O primeiro projeto criado já fica marcado como **Ativo**. Se tiver vários projetos, basta clicar em **Tornar ativo** no card desejado, ou usar os botões de **lápis (Editar)** e **lixeira (Excluir)** quando quiser alterá-lo *(excluir um projeto do Vértice nunca apaga seus arquivos do computador)*.

---

### 3️⃣ Monte sua Equipe de IA (Aba `Agentes` ou `Organograma`)
Você pode criar agentes de duas formas na aba **`Agentes`**:

#### Opção A — Criar Agente Manualmente (`+ Novo agente`)
1. Clique em **`+ Novo agente`**.
2. Preencha:
   - **Nome do agente:** ex.: `Tester`, `Redator`, `Desenvolvedor`.
   - **Função:** ex.: `Testes e validação`.
   - **Runtime e Modelo:** escolha a ferramenta de IA instalada na sua máquina (ex.: *Antigravity CLI*, *Claude Code*, *Kimi CLI*).
   - **Supervisor:** escolha a quem ele responde (ou deixe *Nenhum* para torná-lo o Agente Principal / Gerente).
   - **Instrução de sistema (Prompt):** descreva como esse agente deve trabalhar.
     - 💡 **Dica — Biblioteca de Prompts:** Clique em **Salvar na biblioteca** acima da caixa de texto para guardar esse prompt. Nos próximos agentes, basta selecionar em **Carregar prompt salvo…**!
3. Clique em **Criar agente**. Você pode editar ou remover qualquer agente a qualquer momento clicando no ícone de **lápis** ou **lixeira** no card dele.

#### Opção B — Delegar ao Gerente (`Delegar ao Gerente`)
1. Clique em **`Delegar ao Gerente`**.
2. Descreva o objetivo geral do projeto em linguagem natural.
3. O Gerente criará automaticamente uma equipe de subagentes conectados no organograma e cadastrará as tarefas iniciais no quadro **Work**.

---

### 4️⃣ Crie e Despache Tarefas (Aba `Work`)
A aba **`Work`** organiza o trabalho da equipe em metas e em um quadro Kanban com 4 colunas:
**`A fazer`** → **`Em andamento`** → **`Aguardando aprovação`** → **`Concluído`**

1. **Criar Meta (opcional):** Clique em **`Nova meta`** para agrupar entregas e acompanhar a barra de progresso (`%`).
2. **Criar Tarefa:** Clique em **`+ Nova tarefa`**, informe o **Título** do que precisa ser feito, selecione o **Agente Responsável**, a **Meta** e a **Prioridade**.
3. **Colocar a IA para executar:** No card da tarefa (em *A fazer*), clique na seta **`→` (Mover para frente)** para movê-la para **`Em andamento`**.
   - O Vértice iniciará automaticamente a sessão real do agente na pasta do projeto e enviará a tarefa para a IA executar.
4. **Aprovação Humana Automática:**
   - Assim que a IA terminar de executar a tarefa no terminal, o Vértice detecta a conclusão e move o card **sozinho** de *Em andamento* para **`Aguardando aprovação`**, mostrando no próprio card um resumo (`→ ...`) do que a IA fez.
   - Confira o resultado e, se estiver tudo certo, clique na seta **`→`** para mover para **`Concluído`**!

---

### 5️⃣ Use o Terminal Interativo e a Memória Viva (`Organograma`)
Na aba **`Organograma`**, ao clicar em qualquer agente do mapa:
- **Painel Lateral (`Inspector`):**
  - **Visão geral:** mostra a tarefa atual, runtime, modelo e conexões.
  - **Prompt:** exibe a instrução de sistema do agente.
  - **Memória (Memória Viva):** mostra tudo o que o agente já aprendeu e entregou nas tarefas anteriores. Essa memória é salva em `.vertice/memory/<agente>.md` dentro da pasta do projeto. Você pode **Editar** esse resumo manualmente ou clicar em **Limpar memória** se quiser que o agente recomece do zero.
  - **Eventos:** linha do tempo com tudo o que aconteceu no workspace.
- **Terminal Integrado (barra inferior):**
  - Mostra em tempo real a tela da CLI de cada agente (com suporte completo a cores, setas do teclado, `Enter`, `Esc` e `Ctrl+C`).
  - Ao fechar o Vértice e abri-lo novamente, a conversa anterior continua visível no terminal do agente (`— Memória viva carregada · conversa anterior preservada —`) e, ao iniciar uma nova sessão real, o agente lê automaticamente sua memória viva para continuar exatamente de onde parou!

---

## ❓ Perguntas Frequentes (FAQ)

- **Onde meus dados ficam salvos?**
  Tudo fica salvo localmente no seu computador, em `%APPDATA%\Vértice\data\vertice.db`. Além disso, a memória viva de cada agente é espelhada em `<pasta-do-projeto>\.vertice\memory\`.
- **Se eu fechar o programa ou reiniciar o PC, perco meus agentes, prompts ou conversas?**
  Não! Projetos, agentes, metas, tarefas, biblioteca de prompts, histórico visual do terminal e a memória viva são persistidos em disco e restaurados automaticamente ao abrir o Vértice.
- **Como limpar tudo para começar um ambiente do zero?**
  No topo da tela **`Organograma`**, clique no botão **`Limpar`** (*Operar do zero*). Isso remove agentes, tarefas e projetos antigos, mas **preserva** suas configurações de CLIs e sua **Biblioteca de Prompts Salvos**.

---

## 🛠️ Estrutura do Repositório (Para Desenvolvedores)

Caso queira rodar ou compilar o Vértice a partir do código-fonte:

```text
Vertice/
├── app/                   # Interface visual (React 19 + TypeScript + Vite)
├── core/                  # Serviço local (Node.js + Express + WebSocket + SQLite + node-pty)
├── runtimes/              # Catálogo JSON das CLIs suportadas
└── installers/electron/   # Empacotador Desktop Windows (Electron + electron-builder NSIS)
```

### Comandos principais de desenvolvimento:
```powershell
# 1. Rodar o serviço local (porta 7845)
cd core
npm install
npm run dev

# 2. Rodar a interface em modo desenvolvimento
cd ../app
npm install
npm run dev

# 3. Gerar o instalador Windows (Vertice-Setup-0.1.0.exe)
cd ../app && npm run build
cd ../installers/electron
npm install
npm run dist
```
