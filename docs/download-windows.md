# Janelas de download

As janelas de confirmação, progresso e conclusão usam um layout compacto e separado da janela principal.

## Fluxo

- **Confirmação:** mostra arquivo, tamanho, destino, categoria, limite de velocidade e opções de extração ZIP.
- **Progresso:** mostra bytes recebidos, velocidade de rede, ETA e estado real (`verificando`, `baixando`, `montando` ou `extraindo`).
- **Cancelamento:** permite manter o arquivo parcial para retomada ou apagar os dados locais.
- **Conclusão:** mostra o destino final, resultado da extração e atalhos para abrir o arquivo ou a pasta.

## Extração ZIP e 7z

A extração começa somente após o arquivo final ser concluído. ZIP e 7z, inclusive protegidos por senha, são suportados. Caminhos inseguros, sobrescrita, quantidade excessiva de entradas e taxas de expansão suspeitas são bloqueados. Em caso de erro ou senha inválida, o arquivo compactado original é preservado.

A senha permanece apenas na memória do processo e não é gravada no banco ou no armazenamento do navegador. Consequentemente, uma extração protegida agendada deixa de ser automática se o aplicativo for reiniciado antes de o download terminar.

## Limite de velocidade

Os campos aceitam somente números não negativos, sem o spinner nativo. Campo vazio ou zero significa download ilimitado.
