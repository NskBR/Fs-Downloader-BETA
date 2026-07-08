# AGENTS.md — SF Downloader

Gerenciador de downloads desktop (Tauri 2 + React 18 + TypeScript + Rust).

## Comandos

- Instalar: `npm install` (pnpm-lock existe, mas use **npm** — pnpm não está no ambiente).
- App completo (Rust + UI, janela nativa): `npm run tauri dev`
- Apenas a UI (Vite dev server em `http://127.0.0.1:1420`): `npm run build && npm run dev`
- Build de produção: `npm run build` (roda `tsc && vite build`, sem emitir arquivos — `noEmit:true`).
- Extensão de navegador: `npm run extension:build` (Builds separados em `browser-extension/`).
- **Não há suíte de testes.** Verificação é manual via `tauri dev` ou typecheck implícito no `tsc` do build.

## Arquitetura multi-janela (fato central)

É um SPA único (`index.html` → `src/main.tsx`) que renderiza uma "página" diferente conforme a **label da janela Tauri** (`getCurrentWindow().label`). O roteamento por label está em `src/main.tsx`, não em um router.

| Label | Página | Arquivo |
|-------|--------|---------|
| `main` | App principal (sidebar + telas) | `src/app/App.tsx` |
| `main` | App principal (sidebar + telas) | `src/app/App.tsx` |
| `download-confirm-{token}` | Confirmação de novo download | `src/pages/ConfirmationPage.tsx` |
| `download-progress-{id}` | Janela "Download em andamento" | `src/pages/ProgressPage.tsx` |
| `download-complete-{id}` | Janela de concluído | `src/pages/CompletePage.tsx` |
| `browser-integration` | Popup de integração | `src/pages/BrowserIntegrationPage.tsx` |

- As janelas são criadas no Rust (`src-tauri/src/commands/transfer.rs`, `open_progress_window`/`open_complete_window`/`open_confirm_window`) via `WebviewWindowBuilder`, todas `resizable(false)` e `decorations(false)`: Confirmação `560×220`, Progresso `540×252`, Complete `560×252`. Mude o tamanho em `transfer.rs`, **não** no `tauri.conf.json`.
- **Janelas são borderless** → barras de título são custom e usam `data-tauri-drag-region`. Não remover esse atributo de elementos arrastáveis.
- Janelas filhas (`download-progress-*`, `download-complete-*`) são reveladas pelo backend via comando `show_ready_window` (chamado pelo frontend em `src/main.tsx` após `document.fonts.ready`, com fallback de 2s). Não use `show()` direto nelas — deixe o mecanismo `show_ready_window` cuidar da exibição, senão a janela pode aparecer em branco/antes do CSS.
- Ao adicionar uma nova label de janela, registre-a em `src-tauri/capabilities/default.json` (`windows` e `permissions`), senão a janela abre sem permissões.

## Fluxo de dados de download

- Backend emite evento `download-progress` (`src-tauri/src/download/engine.rs`): `src/hooks/useDownloads.ts` e `src/pages/ProgressPage.tsx` escutam.
- Tipos fonte da verdade: `src/domain/download.ts` → `DownloadTask` e `DownloadProgress`.
- `DownloadTask` já traz `speedAverage`, `supportsRange`, `etag`, etc. A `ProgressPage` atual usa só uma fração — aproveite esses campos em vez de criar estado novo.
- Abrir link externo: comando `open_url` em `src-tauri/src/commands/transfer.rs` (valida http/https, usa `cmd /c start`/`open`/`xdg-open`). Exponha via `services/downloadService.ts` (`openUrl`) — **não** use `window.open` (bloqueado no webview Tauri).
- Deep link: protocolo `sfdownloader://download?url=<https-url>` (registrado em `tauri.conf.json` → `plugins.deep-link`). Tratado em `src/App.tsx`.
- Links consumidos são marcados na sessão para impedir que `F5` duplique downloads ativos. Ao testar deep links, recarregar a janela não deve criar tarefa duplicada.

## Design system / tema

- O **único** CSS importado globalmente é `src/styles/app.css` (via `src/main.tsx`). Ele define o design "Slate & Ember": tokens em `:root` (`--bg`, `--panel`, `--surface`, `--line`, `--text`, `--text-2`, `--muted`, `--ember`=laranja, `--st-downloading/-paused/-completed/-failed/-cancelled`, `--radius`, `--shadow`). **Use sempre esses tokens** — não hardcode cores.
- ⚠️ Há vários outros arquivos em `src/styles/` (`redesign.css`, `xdm-windows.css`, `confirmation-*.css`, etc.), mas **nenhum deles é importado** — são CSS morto. Não crie novos arquivos CSS nem os importe; estenda classes em `app.css`.
- As janelas de progresso/conclusão/confirmação reaproveitam classes de `app.css`: `.download-window`, `.download-window-title`, `.download-window-content`, `.progress-compact`, `.progress-stats`, `.info-row`, `.path-row`, `.btn-primary/secondary/ghost`, `.cancel-overlay/.cancel-dialog`.
- **Escala de UI:** `main.tsx` chama `getCurrentWebview().setZoom(settings.uiScale)`. Estilos em px podem desalinhar em escalas ≠100% — prefira `rem`/relativo onde fizer sentido, e `min-width:0` + `text-overflow:ellipsis` para texto longo não quebrar layout.
- Ícones: `lucide-react`. Ícones de arquivo por extensão: `src/components/downloads/FileIcon.tsx` (mapeia extensão→grupo com cor). Para novos tipos, adicione ao mapa `groups`.

## Convenções de código

- TypeScript `strict:true`; imports de ícones/componentes no topo. `tsc` não emite — build quebra em erro de tipo.
- Estado de download em tempo real vem de eventos Tauri, não de polling. Use `listen("download-progress", …)` e filtre por `payload.id`.
- `vite.config.ts`: dev server porta `1420`, `strictPort`, ignora `src-tauri/target`, `dist`, `target`.

## Pontos de atenção / armadilhas

- Janelas filhas (`progress-*{id}`) usam label dinâmica → seletores CSS baseados em label funcionam (`download-progress-*` nas capabilities).
- `tauri.conf.json` define só a janela `main` (980×480, `visible:false`). As outras janelas são criadas em runtime no Rust.
- Nunca abrir a janela principal visível antes da hora: `main.tsx` controla `show()` conforme `startInTrayMode`.
- `esbuild` exige `onlyBuiltDependencies` (ver `pnpm-workspace.yaml`) — relevante só se migrar para pnpm.
- Arquivos temporários do download **não** ficam ao lado do destino: parciais vão para `<destino>/.sf-temp/<nome>.part`, fatias segmentadas são `<temp>.chunk-<i>`, e extração usa `.sf-extracting-<nome>-<uuid>`. Não hardcode caminhos — use os helpers de `src-tauri/src/download/engine.rs`.

## Documentação de referência

Para detalhes de arquitetura, leia `docs/` em vez de inferir pelo código:
- `docs/window-lifecycle.md`, `docs/download-windows.md` — criação/revelação de janelas e `show_ready_window`.
- `docs/download-engine.md`, `docs/segmented-engine.md`, `docs/resume-downloads.md` — motor HTTP, peças e retomada.
- `docs/database.md` — schema SQLite e repositórios.
