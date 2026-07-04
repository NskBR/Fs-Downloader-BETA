# Categorias personalizadas

As categorias personalizadas são criadas em **Configurações > Categorias personalizadas** e persistidas junto às demais preferências locais.

- O nome define a subpasta criada dentro da pasta principal.
- Extensões são opcionais e permitem detecção automática para formatos que não pertencem a uma categoria padrão.
- Categorias padrão têm prioridade na detecção. A seleção da janela de confirmação sempre pode substituir o destino sugerido.
- Nomes com separadores de caminho, `..` ou caracteres inválidos são bloqueados no frontend e no núcleo Rust.

Na confirmação, o caminho exibido já inclui a categoria escolhida. Assim, um ZIP pode ser enviado manualmente para `Documentos` ou para qualquer categoria personalizada.
