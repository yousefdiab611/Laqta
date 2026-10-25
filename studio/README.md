# Creative Studio

Open **Creative Studio** in the extension popup. To import a website directly, use
**Capture to Studio** while that website is active. The existing editor also has
**Open in Creative Studio**, which transfers its rendered canvas.

- Upload up to 12 PNG, JPEG or WebP images. Select a thumbnail for the main image and OCR.
- Choose a framed screenshot, numbered tutorial, or Before & After layout.
- Tutorials support captions, reordering, removal and arrows with adjustable target coordinates.
- Comparisons use the first two images. Choose side by side or adjust the reveal slider.
  Exported comparisons are static images at the current slider position.
- Four templates provide ivory, coral square, midnight and blue widescreen treatments.
  Square and widescreen aspect ratios apply to the framed screenshot layout.
- Export PNG, WebP or JPEG at widths from 320 to 4096 pixels. Quality affects JPEG/WebP.
  The downloaded file size is shown after export.
- Enable and save a watermark in **Brand Kit**. Studio applies it by default;
  uncheck **Apply saved Brand Kit** to omit it for one export.
- OCR supports English, Arabic and both together. Text is editable and can be copied.
  OCR processes the selected original image, so it does not read template text or watermarks.

Images are held in the current Studio tab and are lost when it closes or reloads.
Capture transfers temporarily use extension local storage and are removed on import.
Brand Kit preferences persist. OCR models are bundled locally; processing does not
upload screenshots. Large compositions are limited to 32 megapixels and 16000 pixels
in height. Reduce width or remove steps if the size warning appears.

## Implementation

This extension contains a compiled editor bundle without its source project.
Studio lives separately and integrates through popup actions, an editor transfer
button and an Export Tools link. Existing editor exports remain as implemented
in that bundle; Studio settings apply to Studio exports.

OCR: Tesseract.js 6.0.1, tesseract.js-core 6.0.0, bundled English and Arabic trained
data. Local worker/core/model paths and MV3 WebAssembly CSP are configured.
See [vendor/README.md](vendor/README.md) for provenance and licenses.

## Verification (2026-10-25)

Tested using Playwright against both localhost and an unpacked extension in Chromium:
English/Arabic text recognition, OCR with network disabled, tutorial numbering,
captions and arrows, slider comparison, WebP download, saved text watermark on/off,
widescreen dimensions, invalid output width recovery and 390px layout without
horizontal overflow. Editor-to-Studio transfer and offline bilingual OCR were also verified.
JavaScript syntax checks passed.
