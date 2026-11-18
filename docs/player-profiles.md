# Playing styles

Choose **Playing style** in Possible moves to see placements ranked as a **Casual**, **Word-list learner**, or **Strong club player** might see them. Analyze uses the same styles for modeled opponent replies. The game's selected dictionary determines which moves are legal. The wordfreq English data provides familiarity estimates for exact spellings, including inflections. The coefficients were initially tuned on WOW24.

## How the model works

1. **Spot moves.** Each simulated player has a seeded vocabulary. On each turn, a style examines a fraction of board locations and recalls some known words. Short hooks and premiums attract attention. Long plays and blank assignments are harder to spot. Every crossword formed by a placement must also be familiar. The search widens if it yields no play.
2. **Choose a move.** Rank the spotted moves by actual points, visible premiums, the hardest word formed, crossword count, tiles placed beyond five, and rack leave. Before ranking its four finalists, Strong checks one-tile threats on triple-word squares and newly opened lanes that reach two major word premiums in a single reply. Learner gives those lanes a smaller weight for its three finalists. Casual ranks its spotted moves using the original scoring terms. An empty bag removes the leave and defense terms. Strong values immediate rack-outs by their rack adjustment.

The [shared profile code](../shared/player-profiles.ts) defines the weights. [Word familiarity](../shared/word-familiarity.ts) uses exact wordfreq entries with a Zipf 3 cutoff. For words without an entry, it uses capped edit distance to up to 10,000 familiar spellings legal in the game's lexicon. Each simulated player keeps the same vocabulary across turns. In Analyze, each shared scenario represents a possible opponent with the same vocabulary across the candidate boards being compared.

## Premium lanes

The lane penalty is three times the biggest increase in two-premium lane risk for Strong and one times that increase for Learner. The scan checks rack capacity, perpendicular word constraints, unseen tiles, and the face value of any tiles the reply would play through. Triple- and quadruple-word squares count as major premiums. The Strong weight was calibrated on simulated WOW24 Scrabble and SOWPODS Lexulous games against expected best replies from 500 shared opponent racks. The Learner weight represents lighter attention to defense.
