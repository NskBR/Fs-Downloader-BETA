# Motor segmentado

O motor usa HTTP Range quando o servidor confirma suporte e o tamanho é conhecido. Arquivos pequenos ou servidores sem Range continuam pelo fluxo único.

## Estratégia

- Divide o arquivo em peças de pelo menos aproximadamente 4 MB.
- Mantém até o limite configurado de conexões simultâneas, entre 2 e 32.
- Cria uma fila com mais peças que workers para reduzir o efeito de uma conexão lenta.
- Cada peça possui arquivo parcial e estado próprio no SQLite.
- Uma falha repete somente aquela peça, até quatro tentativas com backoff.
- Pausa e reinício reconciliam o estado do banco com o tamanho real de cada arquivo parcial.
- A montagem final valida o tamanho exato de todas as peças antes de produzir o arquivo final.

O desenho foi estudado a partir dos conceitos públicos do Xtreme Download Manager: peças, workers limitados, persistência e reaproveitamento do trabalho concluído. A implementação do SF Downloader foi escrita de forma independente em Rust.

Velocidade depende do servidor, rota, disco e limites do provedor. Múltiplas conexões não garantem aumento em servidores que já saturam a conexão com um único fluxo.
