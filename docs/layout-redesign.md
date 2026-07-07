# Redesenho compacto da interface

O shell principal usa sidebar de 160 px, titlebar fixa e área de conteúdo sem footer. O status da integração com o navegador é consultado pela ponte local e exibido no rodapé compacto do próprio sidebar.

## Navegação

- `Downloads` reúne tarefas ativas, concluídas, pausadas, canceladas e falhas.
- Categorias filtram a mesma biblioteca por tipo de arquivo.
- `Ajuda` abre um diálogo com as regras da organização automática.
- `Configurações` mantém somente idioma e pasta padrão.

## Lista

Nome, data, tamanho e status possuem ordenação ascendente/descendente. Progresso e velocidade permanecem próximos ao nome para preservar densidade e leitura rápida.

## Tema

O seletor fica na titlebar e oferece Sistema, Claro e Escuro. A preferência é persistida junto às demais configurações e aplicada imediatamente.

## Viabilidade de redesenho total

É viável refazer totalmente o design e a disponibilização do layout no futuro. A arquitetura atual já separa razoavelmente:

- shell principal e navegação em React;
- janelas independentes de confirmação, progresso e conclusão;
- núcleo de download em Rust;
- persistência SQLite;
- extensão de navegador.

O ponto de atenção é que o layout hoje ainda carrega estilos históricos acumulados em vários arquivos CSS. Um redesign completo é recomendado, mas deve ser feito como uma fase própria, com migração controlada para evitar regressões em downloads ativos, janelas auxiliares, tray icon, tema, escala da interface e integração com a extensão.

Plano recomendado para um redesign futuro:

1. criar um design system simples com tokens de cor, espaçamento, tipografia, estados e botões;
2. substituir gradualmente CSS legado por componentes compactos reutilizáveis;
3. redesenhar primeiro as janelas de download, depois a lista principal, depois configurações/perfil;
4. manter testes de build e fluxo manual de download/pausa/retomada a cada etapa;
5. só no final remover estilos antigos e consolidar os arquivos CSS.

Conclusão: o redesign total é tecnicamente seguro e desejável, desde que entre como uma fase isolada e não misturado com mudanças no motor de download.
