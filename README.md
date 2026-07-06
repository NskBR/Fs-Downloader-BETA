# SF Downloader

Base desktop criada na FASE 0 com React + TypeScript e Tauri + Rust.

## Executar

```bash
npm install
npm run tauri dev
```

Para validar apenas a interface, use `npm run build` e `npm run dev`.

## Estrutura

- `src/app`: composição e navegação
- `src/components`: componentes reutilizáveis
- `src/pages`: telas do produto
- `src/styles`: tema global
- `src-tauri`: shell desktop e futuro núcleo Rust

## FASE 1

- Interface atualizada conforme a referência visual aprovada.
- Pasta principal selecionada pelo diálogo nativo do sistema.
- Configurações de organização, velocidade base, conexões e downloads simultâneos.
- Preferências persistidas localmente no WebView.
- Criação das categorias `Imagens`, `Vídeos`, `Áudios`, `Documentos`, `Compactados`, `Executáveis`, `Programas`, `Torrents` e `Outros` pelo núcleo Rust.
- Tela Organização com extensões e prévia dos destinos.

## FASE 2

- SQLite embarcado, criado automaticamente no diretório de dados do aplicativo.
- Migração inicial versionada com todas as seis tabelas do roadmap.
- Modelos fortes para tarefas, chunks, fontes, histórico, configurações e perfil.
- Repositório independente com criação, consulta, atualização e remoção de downloads.
- Comandos Tauri preparados para consumo pela interface.
- Chaves estrangeiras, exclusão em cascata, índices e tratamento contextual de erros.

Detalhes da arquitetura estão em `docs/database.md`. O mecanismo HTTP de download será implementado na FASE 3.

## FASE 3

- Download HTTP/HTTPS simples e assíncrono.
- Detecção de nome, tamanho, MIME, extensão e metadados HTTP.
- Arquivo parcial `.part`, progresso e velocidade em tempo real.
- Organização automática, proteção contra nomes perigosos e colisões.
- Cancelamento, finalização segura e registro no histórico.
- Tela Downloads integrada ao banco e aos eventos do núcleo Rust.

Consulte `docs/download-engine.md` para conhecer o fluxo e os limites atuais.

## FASE 4

- Pausa e cancelamento tratados como ações distintas.
- Retomada por HTTP Range a partir do tamanho real do `.part`.
- Validação de ETag e Last-Modified antes de anexar novos bytes.
- Recuperação de tarefas interrompidas na inicialização do aplicativo.
- Bloqueio seguro quando o servidor não oferece retomada.
- Controles de pausar, continuar e cancelar na interface.

As regras de integridade estão documentadas em `docs/resume-downloads.md`.

## Motor segmentado

Downloads com HTTP Range e tamanho conhecido usam peças persistentes, fila concorrente, retries isolados e montagem validada. Consulte `docs/segmented-engine.md`.

## Extensão de navegador

A integração WebExtensions fica em `browser-extension` e possui builds separados para navegadores Chromium e Firefox. Ela oferece popup, menu de contexto e captura automática opcional, comunicando-se com o desktop pelo protocolo validado `sfdownloader://`.

```bash
npm run extension:build
```

Consulte `browser-extension/README.md` para instalar os builds descompactados.

## Atualização Beta 0.2.x

- Estabilidade do motor de download com menor chance de `database is locked`, persistência SQLite menos agressiva e recuperação gradual de conexões após limitação do provedor.
- Melhor suporte a múltiplos downloads simultâneos, pausas, retomadas e registro de falhas/cancelamentos sem duplicar estatísticas.
- Extração automática serializada para reduzir impacto em downloads ativos, com contabilização de leitura e escrita em disco.
- Página **Meu Perfil** com total geral baixado, volume concluído, falhado e cancelado, escrita/leitura estimada no SSD, velocidade média e resumo por tipo de arquivo.
- Extensão Chromium atualizada para interceptar cliques de download mais cedo via content script, reduzindo registros cancelados no gerenciador nativo do navegador.
- Interface recebeu melhorias compactas: domínio/link de origem, botão de copiar link, minimizar janela de progresso, botão de fechar em alertas de erro e ajustes de sidebar.

Descrição sugerida para o GitHub: **SF Downloader é um gerenciador de downloads desktop em Tauri, React e Rust, com downloads segmentados, retomada, organização automática, extensão de navegador e estatísticas locais.**

## Rodada de estabilização e identidade visual

- Deep links consumidos ficam marcados durante a sessão, impedindo que `F5` duplique downloads ativos.
- Todo link recebido passa por uma confirmação com nome, extensão, tamanho e pasta de destino.
- Seleção múltipla no estilo de gerenciadores de navegador, colunas redimensionáveis e progresso baixado/total.
- Histórico real com filtros, seleção, exclusão, abertura do arquivo e revelação da pasta.
- Confirmação de download concluído com acesso rápido ao diretório.
- Tema “Obsidian”: carvão quente, cobre e verde de estado, substituindo a aparência azul/roxa genérica.

Observação: navegadores podem exigir uma confirmação própria para abrir o protocolo externo. A extensão fecha automaticamente a aba auxiliar; eliminar completamente a confirmação e o registro cancelado do navegador exigirá uma integração Native Messaging assinada/instalada.

## Estabilização Avançada (Fase Beta)

Implementações de refinamento técnico e estabilização para o lançamento Beta:
- **Fim dos Flashes Brancos (Visual Obsidian):** Configuração de cor de fundo nativa na criação das Webviews e injeção de CSS embutido no HTML. A janela abre instantaneamente escura, sem flashes brancos ao iniciar ou abrir popups.
- **Organização Limpa (Pasta `.sf-temp`):** Todos os arquivos parciais (`.part`) e fatias temporárias (`.chunk-*`) são movidos para uma pasta oculta chamada `.sf-temp` dentro do diretório de destino do download. Ao concluir, a pasta temporária é limpa e removida de forma segura.
- **Subsystem de Windows (Sem CMD):** Habilitado o atributo de subsistema Windows no executável Rust de produção. O aplicativo de produção compila sem abrir a janela preta do console do CMD.
- **Menu de Contexto Completo (Botão Direito):** Adicionado suporte a cliques com o botão direito nas tarefas de download, permitindo pausar, retomar, cancelar, limitar velocidade, excluir e abrir pastas ou arquivos de forma ágil.
- **Opção de Retomada Personalizada (Chavinha de Controle):** Incluída uma chavinha no diálogo de novo download que permite ao usuário escolher se quer manter o suporte a retomar downloads parados/cancelados. Se desmarcado, downloads recomeçam do zero se interrompidos.
- **Validação de Extensão Aprovada (Mozilla AMO):** Ajustes nos ícones nativos e inclusão da chave de privacidade obrigatória `data_collection_permissions` no manifesto, obtendo aprovação de 100% de sucesso nos testes automatizados da Mozilla.

## Futuro do Aplicativo (Roadmap)

Planejado para as próximas versões de atualização:
1. **Limitação Dinâmica e Individual de Velocidade:** Possibilidade de ajustar a velocidade de downloads individuais de forma dinâmica pelo menu de contexto enquanto o download está ativo.
2. **Fila de Downloads Sequencial Avançada:** Gerenciar downloads de forma sequencial com controle de prioridades de fila estruturada.
3. **Agendador de Downloads:** Programar horários específicos para início e pausa automática de downloads.
4. **Integração via Native Messaging:** Substituição do protocolo de deep links `sfdownloader://` por Native Messaging nativo no Chrome/Firefox, permitindo capturar links silenciosamente sem abrir abas temporárias.
5. **Suporte a BitTorrent / SFTP:** Expandir a engine de downloads segmentados para suportar novos protocolos além do HTTP/HTTPS.
