# Data and references

## Wordnik

Bundled `public/dictionaries/wordnik.txt` is the 2021-07-29 word list from https://github.com/wordnik/wordlist, downloaded 2026-11-12. Copyright (c) 2020 Wordnik; MIT license. The complete license is included in `public/dictionaries/WORDNIK-LICENSE.txt`. The application strips quote delimiters and normalizes case when loading the unmodified source file.

## wordfreq

The playing styles use the unmodified English, French, and Italian frequency assets from Robyn Speer's [wordfreq 3.1.1](https://pypi.org/project/wordfreq/3.1.1/). The data is distributed under CC BY-SA 4.0. See the [license and source attributions](public/dictionaries/WORDFREQ-NOTICE.md). The [MessagePack decoder](https://github.com/msgpack/msgpack-javascript) is ISC licensed.

## Moby Words II

The bundled public-domain Moby Words II frequency list by Grady Ward (`freq.txt`) comes from [Moby Words II](https://github.com/fordsfords/moby_words_2).

## ENABLE

Bundled `public/dictionaries/enable.txt` is ENABLE1 from https://github.com/dolph/dictionary/blob/master/enable1.txt, downloaded 2026-11-12. ENABLE (Enhanced North American Benchmark Lexicon), originally compiled by M. Cooper and A. Beale, is a public-domain word list. It is not an official current WWF or tournament dictionary.

## Private dictionaries

User-provided word lists are stored in `data/dictionaries`, excluded from Git and Docker build context. They retain their original terms. No WOW, CSW, or NWL list is bundled with the source or image.

The optional French list is based on the **Grammalecte 7.7** French spelling dictionary by Olivier R. and contributors. [LetterUnmix's expanded, accent-folded text list and source notices](https://letterunmix.com/sources/) are distributed under the [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/). The list may be imported manually and is stored in `data/dictionaries`.

## Gameplay references

- Scrabble rules: https://instructions.hasbro.com/en-gb/instruction/scrabble-game
- French Scrabble rules and distribution: [FFSc international classic rules](https://www.ffsc.fr/classique.php?page=reglements) and [Michel Duguet's French tile table](https://media.electre-ng.com/extraits/extrait-id/59c90a35e79d158ea169362b8b318a1cd38688f4d670cd257fea4acc80df3ea4.pdf).
- Wordfeud French tile distribution and scoring: [Wordfeud Help](https://wordfeud.com/wfweb/help/).
- Lexulous language choices and English tile bags: [Lexulous dictionary choices](https://forum.lexulous.com/topic/13/dictionary-word-list-choices?page=2) and [Lexulous tile distribution](https://buzz.lexulous.com/posts/tile-distribution). Classic French and Italian tile counts and values follow the published [Scrabulizer Lexulous designs](https://www.scrabulizer.com/design/lexulous/cheat).
- Words With Friends scoring and 35-point bonus: https://zyngasupport.helpshift.com/hc/en/63-words-with-friends-2/faq/10552-words-with-friends-rule-book/
- Super Scrabble rules: https://winning-moves.com/images/SuperScrabbleRulesSheet2.pdf
- Layout reference: https://scrabble-solver.org/ and its published board configurations. No implementation code or artwork was copied from that project. Tilemaxx has its own solver and UI.

Scrabble and Words With Friends names belong to their respective owners. Tilemaxx is an independent personal companion and is not affiliated with them.

## Screenshot recognition

[Tesseract.js](https://github.com/naptha/tesseract.js) and [Tesseract.js-core](https://github.com/naptha/tesseract.js-core) are Apache-2.0 licensed. The English model is supplied by the MIT-licensed [`@tesseract.js-data/eng`](https://github.com/naptha/tessdata) package. `npm run prepare:ocr` copies their browser assets into `public/ocr`; all OCR requests stay on the local server. The screenshot itself stays in the browser. Generated OCR assets are excluded from Git and rebuilt from locked npm dependencies.

`tests/fixtures/board.png` is original synthetic test artwork, generated with `scripts/create-ocr-fixture.ts`. It is not a screenshot from Scrabble GO. Real app screenshots, tile skins and physical iPhone keyboard behavior still need device testing.

## HEIF import

[libheif-js](https://github.com/catdad-experiments/libheif-js) 1.23.5 supplies the local HEIF decoder (LGPL-3.0). Its unmodified WebAssembly build loads only for conversion; no image is sent to a conversion service. Upstream source and build scripts are available in that repository. Package and decoder license notices are copied to `public/ocr/`. `tests/fixtures/board.heic` was generated from our original `board.png` fixture using macOS `sips`.
