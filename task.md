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

- `[x]` **Correção do Menu de Contexto Cortado (Tauri Native Menu)**
  - `[x]` Remover menu HTML customizado sujeito a cortes do webview
  - `[x]` Implementar menu de contexto nativo com a API de menus do Tauri (`tauri::menu` em Rust)
  - `[x]` Escutar ações do menu no frontend para Pausar, Retomar, Novo Link, Limite, Cancelar, Excluir, Abrir pasta e Abrir arquivo

- `[x]` **Ajuste de Altura e Remoção de Espaço Vazio na Tela de Conclusão**
  - `[x]` Reduzir dimensões padrão da janela de conclusão de `300px` para `195px` em [transfer.rs](file:///C:/Users/skell/Documents/Projeto/src-tauri/src/commands/transfer.rs)
  - `[x]` Ajustar flex e padding do conteúdo em [download-windows.css](file:///C:/Users/skell/Documents/Projeto/src/styles/download-windows.css) para que não estique
  - `[x]` Corrigir altura dos botões inferiores para evitar cortes

- `[x]` **Comportamento Inteligente no Duplo Clique**
  - `[x]` Encaminhar o usuário para a tela de conclusão correta (`CompletePage`) quando o item estiver com status "completed"
  - `[x]` Abrir a janela de progresso correspondente para os demais estados

- `[x]` **Descompressão ZIP e 7z Automática (Codex)**
  - `[x]` Suporte a extração segura de arquivos ZIP/7z (inclusive protegidos por senha)
  - `[x]` Salvamento seguro de senhas em memória

- `[x]` **Categorias Personalizadas (Codex)**
  - `[x]` Cadastro de categorias em Configurações > Categorias
  - `[x]` Validação de caminhos e caracteres especiais no Rust/React

- `[x]` **Melhorias do Navegador (Codex)**
  - `[x]` Suporte a nomes codificados em UTF-8 (RFC 5987 / `filename*=`)

- `[x]` **Verificação e Compilação**
  - `[x]` Executar `npm run build` e `cargo check` com sucesso completo
  - `[x]` Compilar extensão com `node build.mjs` com sucesso completo

- `[x]` **Desempenho, tempo decorrido e extração ampliada (Codex)**
  - `[x]` Limitar eventos globais de progresso a um a cada 200 ms por download
  - `[x]` Reduzir persistência SQLite e eliminar o `SELECT` redundante após cada atualização
  - `[x]` Ativar WAL e sincronização normal no SQLite
  - `[x]` Exibir tempo decorrido na lista e na janela de conclusão
  - `[x]` Adicionar extração para RAR, TAR, TAR.GZ/TGZ e GZ, além de ZIP e 7z
