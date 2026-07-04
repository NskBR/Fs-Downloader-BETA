# Motor de download simples

A FASE 3 implementa uma transferência HTTP/HTTPS por arquivo. O motor fica em `src-tauri/src/download` e não depende da interface React.

## Fluxo

1. Valida URL e pasta principal.
2. Abre a conexão seguindo no máximo dez redirecionamentos.
3. Detecta nome, tamanho, MIME, extensão, ETag e Last-Modified quando disponíveis.
4. Sanitiza o nome e escolhe a categoria configurada.
5. Persiste a tarefa no SQLite.
6. Grava o fluxo em um arquivo `.part` e emite progresso para a UI.
7. Ao concluir, move o parcial para o caminho final e registra o histórico.

Nomes existentes não são sobrescritos: o motor adiciona um contador. Cancelamentos preservam o `.part`, registram o estado e interrompem inclusive uma conexão que esteja aguardando dados.

## Limites desta fase

Ainda não há retomada, Range Requests, múltiplos segmentos ou retentativas. Esses comportamentos entram nas fases seguintes.
