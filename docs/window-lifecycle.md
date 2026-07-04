# Ciclo de abertura das janelas

As janelas secundárias de confirmação, progresso e conclusão são criadas com `visible(false)` e tamanho definitivo. O WebView carrega o HTML, tema, CSS, React e fontes sem ser exibido.

Depois do primeiro commit visual, o frontend aguarda dois frames e `document.fonts.ready`, então chama `show_ready_window`. O núcleo mostra e focaliza a janela somente nesse momento, evitando flash branco, conteúdo incompleto e redimensionamento visível.

O `index.html` contém um loading mínimo no próprio documento para cobrir a inicialização anterior ao bundle JavaScript. Um fallback de dois segundos evita que uma falha inesperada mantenha a janela invisível indefinidamente.
