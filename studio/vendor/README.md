# Bundled OCR dependencies

- tesseract.js 6.0.1: https://registry.npmjs.org/tesseract.js/-/tesseract.js-6.0.1.tgz
  Browser runtime and worker. License: TESSERACT-LICENSE.md.
- tesseract.js-core 6.0.0: https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-6.0.0.tgz
  WebAssembly core variants. License: CORE-LICENSE.
- English and Arabic models:
  https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz
  https://tessdata.projectnaptha.com/4.0.0/ara.traineddata.gz
  License: TESSDATA-LICENSE, from https://github.com/tesseract-ocr/tessdata.

All runtime files and models are local extension assets. Do not replace these
paths with CDN scripts: Manifest V3 requires packaged executable code.
