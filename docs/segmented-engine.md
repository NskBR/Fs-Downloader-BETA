# Motor segmentado

O motor usa HTTP Range quando o servidor confirma suporte e o tamanho é conhecido. Arquivos pequenos ou servidores sem Range continuam pelo fluxo único.

## Estratégia

- Divide o arquivo em peças de pelo menos aproximadamente 4 MB.
- Mantém até o limite configurado de conexões simultâneas, entre 2 e 32.
- Cria uma fila com mais peças que workers para reduzir o efeito de uma conexão lenta.
- Um único `.part` é pré-alocado com o tamanho final. Cada peça grava diretamente na sua posição usando seek, enquanto seu estado permanece separado no SQLite.
- Uma falha repete somente aquela peça com backoff. Se Range for recusado, a engine repete com headers mínimos e uma única conexão serializada.
- Se Range falhar antes de qualquer byte ser aceito, a engine abandona automaticamente o plano segmentado e inicia um fluxo simples. Se já houver progresso, o parcial é preservado em vez de ser descartado.
- Pausa e reinício recuperam o progresso pelo SQLite; o tamanho físico do `.part` pré-alocado não é confundido com bytes concluídos.
- Downloads antigos com `.part.chunk-N` são migrados automaticamente para o `.part` único na primeira retomada.
- A finalização valida todos os estados, sincroniza o `.part` no disco e apenas o renomeia, sem copiar o arquivo inteiro novamente.

O desenho foi estudado a partir dos conceitos públicos do Xtreme Download Manager: peças, workers limitados, persistência e reaproveitamento do trabalho concluído. A implementação do SF Downloader foi escrita de forma independente em Rust.

Velocidade depende do servidor, rota, disco e limites do provedor. Múltiplas conexões não garantem aumento em servidores que já saturam a conexão com um único fluxo.
