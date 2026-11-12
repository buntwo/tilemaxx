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
