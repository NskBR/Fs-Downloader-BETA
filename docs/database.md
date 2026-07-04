# Persistência local

O banco SQLite é criado automaticamente em `app_data_dir/sf_downloader.sqlite3` na inicialização do Tauri. A versão do esquema é controlada por `PRAGMA user_version`.

## Camadas

- `database/migrations.rs`: esquema e migrações incrementais.
- `database/models.rs`: tipos serializáveis usados pelo núcleo e pelos comandos.
- `database/repositories`: operações SQL isoladas por domínio.
- `commands`: fronteira Tauri consumida futuramente pela interface.

## Tabelas da migração 001

`download_tasks`, `download_chunks`, `download_sources`, `history_items`, `app_settings` e `user_profiles`.

As chaves estrangeiras são habilitadas em toda conexão. Chunks e fontes são removidos em cascata quando sua tarefa é removida. O banco usa espera de até cinco segundos quando estiver ocupado.

## Comandos disponíveis

- `create_download`
- `list_downloads`
- `update_download`
- `remove_download`

Esta fase cria apenas a persistência. O mecanismo HTTP que alimentará esses comandos pertence à FASE 3.
