# Data and references

## Wordnik

Bundled `public/dictionaries/wordnik.txt` is the 2021-07-29 word list from https://github.com/wordnik/wordlist, downloaded 2026-11-12. Copyright (c) 2020 Wordnik; MIT license. The complete license is included in `public/dictionaries/WORDNIK-LICENSE.txt`. The application strips quote delimiters and normalizes case when loading the unmodified source file.

## ENABLE

Bundled `public/dictionaries/enable.txt` is ENABLE1 from https://github.com/dolph/dictionary/blob/master/enable1.txt, downloaded 2026-11-12. ENABLE (Enhanced North American Benchmark Lexicon), originally compiled by M. Cooper and A. Beale, is a public-domain word list. It is not an official current WWF or tournament dictionary.

## Private dictionaries

User-provided word lists are stored in `data/dictionaries`, excluded from Git and Docker build context. They retain their original terms. No CSW or NWL list is bundled with the source or image.

## Gameplay references

- Scrabble rules: https://instructions.hasbro.com/en-gb/instruction/scrabble-game
- Words With Friends scoring and 35-point bonus: https://zyngasupport.helpshift.com/hc/en/63-words-with-friends-2/faq/10552-words-with-friends-rule-book/
- Super Scrabble rules: https://winning-moves.com/images/SuperScrabbleRulesSheet2.pdf
- Layout reference: https://scrabble-solver.org/ and its published board configurations. No implementation code or artwork was copied from that project. Tilewise has its own solver and UI.

Scrabble and Words With Friends names belong to their respective owners. Tilewise is an independent personal companion and is not affiliated with them.

## Screenshot recognition

[Tesseract.js](https://github.com/naptha/tesseract.js) and [Tesseract.js-core](https://github.com/naptha/tesseract.js-core) are Apache-2.0 licensed. The English model is supplied by the MIT-licensed [`@tesseract.js-data/eng`](https://github.com/naptha/tessdata) package. `npm run prepare:ocr` copies their browser assets into `public/ocr`; all OCR requests stay on the local server. The screenshot itself stays in the browser. Generated OCR assets are excluded from Git and rebuilt from locked npm dependencies.

`tests/fixtures/board.png` is original synthetic test artwork, generated with `scripts/create-ocr-fixture.ts`. It is not a screenshot from Scrabble GO. Real app screenshots, tile skins and physical iPhone keyboard behavior still need device testing.

## HEIF import

[libheif-js](https://github.com/catdad-experiments/libheif-js) 1.23.5 supplies the local HEIF decoder (LGPL-3.0). Its unmodified WebAssembly build loads only for conversion; no image is sent to a conversion service. Upstream source and build scripts are available in that repository. Package and decoder license notices are copied to `public/ocr/`. `tests/fixtures/board.heic` was generated from our original `board.png` fixture using macOS `sips`.
