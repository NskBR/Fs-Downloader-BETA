# Filtros de captura da extensão

A extensão do SF Downloader possui uma chave principal **Capturar downloads** e uma lista de tipos capturados no popup.

Quando a captura está ligada, cada extensão marcada pode ser enviada para o aplicativo. Quando uma extensão é desmarcada, o navegador continua responsável por aquele tipo de arquivo. Exemplo: desmarcar `MP4`, `MP3` ou `TXT` impede que esses formatos sejam interceptados automaticamente.

Os filtros são salvos no `chrome.storage.local` / `browser.storage.local` da própria extensão e não alteram o banco SQLite do aplicativo.

## Comportamento esperado

- Captura desligada: nenhum download é enviado automaticamente ao app.
- Captura ligada + extensão marcada: a extensão tenta enviar o download ao SF Downloader.
- Captura ligada + extensão desmarcada: a extensão ignora o arquivo e deixa o navegador seguir normalmente.
- Menu de contexto **Baixar com SF Downloader** continua disponível para envio manual de links.

## Observação Chromium

Em Chromium Manifest V3, o bloqueio silencioso perfeito do gerenciador nativo do navegador tem limitações. O content script captura cliques comuns antes do download começar, mas downloads disparados por scripts ou fluxos especiais ainda podem cair no fallback `downloads.onDeterminingFilename`.

Para reduzir a chance do Chromium abrir a janela nativa de salvamento antes do SF Downloader, o fallback segue a mesma ideia do XDM: a decisão usa estado em memória já sincronizado com o aplicativo e cancela o item imediatamente em `downloads.onDeterminingFilename`, sem consultar `chrome.storage` no caminho crítico.
