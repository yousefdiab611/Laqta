# Shared interface palette

Status: adopted

The popup-only blue theme left the editor and utility pages visually unrelated.
Use neutral charcoal, ivory text, and vivid orange accents throughout
the extension. A shared assets/theme/laqta-theme.css defines semantic tokens
for both dark and light modes and is loaded after each page's existing styles.

The compiled editor's light theme now reuses the dark theme's semantic token
references while retaining its own mode. Root data-theme switches the palette.
Small editor overrides handle its hardcoded Copy button and navigation colors.

Popup motion remains in popup/laqta.css. Screenshot pixels, color swatches,
user-selected image backgrounds, and Studio export templates are not recolored
by the interface theme.
