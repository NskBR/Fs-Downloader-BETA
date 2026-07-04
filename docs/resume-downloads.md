# Pausa, retomada e recuperação

Downloads pausados preservam o arquivo `.part`. Ao continuar, o núcleo mede o tamanho real do parcial e solicita somente os bytes restantes com `Range: bytes=<offset>-`.

## Proteções

- Uma retomada com dados parciais exige resposta HTTP `206 Partial Content`.
- ETag e Last-Modified são comparados quando ambos estão disponíveis.
- Se o servidor não aceitar Range ou os metadados mudarem, a retomada é bloqueada e o `.part` permanece intacto.
- Downloads já ativos não podem ser iniciados novamente em paralelo.
- Se o `.part` já contiver o tamanho total esperado, ele é apenas finalizado.

## Recuperação após encerramento

Na inicialização, tarefas `pending` ou `downloading` são reconciliadas com o tamanho real do `.part` e retomadas automaticamente. Se a reconexão falhar ou o servidor não aceitar Range, permanecem pausadas para uma nova tentativa manual. Downloads que o usuário pausou deliberadamente continuam pausados.

Servidores sem suporte a Range ainda permitem downloads normais, mas não conseguem continuar um arquivo parcial. Reinício automático e retentativas pertencem a uma evolução posterior.
