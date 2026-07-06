# Meu Perfil — estatísticas locais

A página **Meu Perfil** resume os downloads registrados localmente, separando volumes concluídos, falhados e cancelados. Ela apresenta volume total geral, quantidade de arquivos, velocidade média, dia de maior atividade e distribuição por categoria.

O valor **Gravado no SSD** representa o mínimo confirmado pelo tamanho dos arquivos finais. Downloads parciais, cache do sistema de arquivos e arquivos produzidos durante extrações ainda não entram nesse número.

A partir desta evolução, cada download é registrado em uma contabilidade independente do histórico. O maior progresso alcançado é preservado inclusive em falhas e cancelamentos, mesmo quando o arquivo parcial é apagado. Se o mesmo download for retomado e concluído, o registro é atualizado para concluído em vez de duplicado.

Downloads concluídos armazenam também a escrita do arquivo final, leitura do compactado durante a extração e tamanho dos arquivos extraídos. Registros antigos são migrados com o tamanho final conhecido, mas permanecem marcados como não medidos para leitura física.
