# Pausa, retomada e recuperação

Downloads pausados preservam o arquivo `.part`. Ao continuar, o núcleo mede o tamanho real do parcial e solicita somente os bytes restantes com `Range: bytes=<offset>-`.

Downloads segmentados preservam cada arquivo de chunk e o progresso registrado no SQLite. Ao retomar, chunks concluídos são mantidos; chunks interrompidos são reconciliados com o tamanho real em disco e continuam a partir do último byte confirmado.

## Proteções

- Uma retomada com dados parciais exige resposta HTTP `206 Partial Content`.
- ETag forte é comparado quando está disponível. `Last-Modified` é apenas informativo, pois CDNs e links assinados podem alterá-lo sem alterar o arquivo.
- Se o servidor não aceitar Range ou os metadados mudarem, a retomada é bloqueada e o `.part` permanece intacto.
- Downloads já ativos não podem ser iniciados novamente em paralelo.
- Pausar cancela somente as conexões de rede: a janela de progresso permanece aberta e acompanha o estado persistido.
- Alterar o limite de velocidade atualiza o controle da tarefa em execução, sem usar pausa/retomada internamente.
- Se o `.part` já contiver o tamanho total esperado, ele é apenas finalizado.

## Recuperação após encerramento

Na inicialização, tarefas `pending` ou `downloading` são reconciliadas com o tamanho real do `.part` e retomadas automaticamente. Se a reconexão falhar ou o servidor não aceitar Range, permanecem pausadas para uma nova tentativa manual. Downloads que o usuário pausou deliberadamente continuam pausados.

Servidores sem suporte a Range ainda permitem downloads normais, mas não conseguem continuar um arquivo parcial. Reinício automático e retentativas pertencem a uma evolução posterior.
