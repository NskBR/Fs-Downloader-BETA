# Histórico de Tarefas Concluídas

Abaixo estão todas as tarefas executadas nesta sessão:

- `[x]` **Alternador de Temas (TitleBar)**
  - `[x]` Limitar ciclo de temas a Claro/Escuro em [TitleBar.tsx](file:///C:/Users/skell/Documents/Projeto/src/components/layout/TitleBar.tsx)

- `[x]` **Sidebar Footer & Status**
  - `[x]` Reduzir dimensões de botões e ícones em [redesign.css](file:///C:/Users/skell/Documents/Projeto/src/styles/redesign.css)
  - `[x]` Simplificar texto de status para `• extensão` em [AppShell.tsx](file:///C:/Users/skell/Documents/Projeto/src/components/layout/AppShell.tsx)
  - `[x]` Adicionar versão do aplicativo `v{appVersion}` no rodapé

- `[x]` **Página de Configurações (Estilo Windows)**
  - `[x]` Reformular HTML para lista limpa sem cards em [SettingsPage.tsx](file:///C:/Users/skell/Documents/Projeto/src/pages/SettingsPage.tsx)
  - `[x]` Estilizar elementos planos, link azul e botão azul Windows em [redesign.css](file:///C:/Users/skell/Documents/Projeto/src/styles/redesign.css)
  - `[x]` Reduzir espaçamento superior para colar o conteúdo ao rodapé da TitleBar e remover espaços vazios

- `[x]` **Tema Claro & Contraste**
  - `[x]` Corrigir a especificidade das variáveis CSS no Tema Claro (`:root[data-theme="light"]`) para corrigir textos ilegíveis
  - `[x]` Melhorar o contraste de textos, botões e status badges no Tema Claro
  - `[x]` Limpar contornos de foco nativos nos botões de navegação

- `[x]` **Integração & Desconexão da Extensão**
  - `[x]` Desativar sincronização no background e enviar requisição de `/disconnect` quando a chavinha for desligada
  - `[x]` Exibir bolinha cinza (desconectado) no app e na extensão imediatamente
  - `[x]` Adicionar versão da extensão no popup da extensão
  - `[x]` Atualizar versão da extensão para 0.2.1 no Firefox e Chromium

- `[x]` **Tabela de Downloads (Colunas, Divisória & Drag & Drop)**
  - `[x]` Centralizar textos e cabeçalhos de Data, Tamanho e Status
  - `[x]` Adicionar borda vertical divisória à esquerda da coluna de Tamanho
  - `[x]` Implementar reordenação de colunas por arraste (Drag-and-Drop) com persistência em localStorage (v4)
  - `[x]` Mapear Nome como coluna flexível `1fr` e remapear Data para ser redimensionável

- `[x]` **Verificação e Compilação**
  - `[x]` Executar `npm run build` com sucesso completo
  - `[x]` Compilar extensão com `node build.mjs` com sucesso completo
