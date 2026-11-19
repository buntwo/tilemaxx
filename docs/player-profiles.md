# Playing styles

Choose **Playing style** in Possible moves to see placements ranked as a **Casual**, **Word-list learner**, or **Strong club player** might see them. Analyze uses the same styles for modeled opponent replies. The game's selected dictionary determines which moves are legal. The wordfreq English data provides familiarity estimates for exact spellings, including inflections. The coefficients were initially tuned on WOW24.


## Bingo hunter

Choose **Bingo hunter** in Possible moves and select **Run Bingo hunter** for the current position. Utility adds a move’s bingo points now to the average score of the best legal bingo on the following turn. Ordinary points on the current move contribute zero. Each future turn without a bingo contributes zero.

The search screens placements to select up to 20 candidates, then samples the same opponent rack and bag order across moves. The reply model picks the highest score plus rack-leave value and passes when there is no legal placement. Finalists receive up to 384 shared deals, with an early-stop check at 192. With up to three tiles in the bag, the search tries to enumerate tile deals exactly. The utility breakdown shows how many deals were checked, the chance of a bingo after the reply, and its average best score when available.

## How the model works

1. **Spot moves.** Each simulated player has a seeded vocabulary. On each turn, a style examines a fraction of board locations and recalls some known words. Short hooks and premiums attract attention. Long plays and blank assignments are harder to spot. Every crossword formed by a placement must also be familiar. The search widens if it yields no play.
2. **Choose a move.** Rank the spotted moves by actual points, visible premiums, the hardest word formed, crossword count, tiles placed beyond five, and rack leave. Before ranking its four finalists, Strong checks one-tile threats on triple-word squares and newly opened lanes that reach two major word premiums in a single reply. Learner gives those lanes a smaller weight for its three finalists. Casual ranks its spotted moves using the original scoring terms. An empty bag removes the leave and defense terms. Strong values immediate rack-outs by their rack adjustment.

The [shared profile code](../shared/player-profiles.ts) defines the weights. [Word familiarity](../shared/word-familiarity.ts) uses exact wordfreq entries with a Zipf 3 cutoff. For words without an entry, it uses capped edit distance to up to 10,000 familiar spellings legal in the game's lexicon. Each simulated player keeps the same vocabulary across turns. In Analyze, each shared scenario represents a possible opponent with the same vocabulary across the candidate boards being compared.

## Premium lanes

The lane penalty is three times the biggest increase in two-premium lane risk for Strong and one times that increase for Learner. The scan checks rack capacity, perpendicular word constraints, unseen tiles, and the face value of any tiles the reply would play through. Triple- and quadruple-word squares count as major premiums. The Strong weight was calibrated on simulated WOW24 Scrabble and SOWPODS Lexulous games against expected best replies from 500 shared opponent racks. The Learner weight represents lighter attention to defense.

## Exchange suggestions

When a style chooses to exchange, **Swap** in Possible moves marks those tiles and opens **Simulate exchange**. Casual and Word-list learner use rack quality to compare swaps with the style’s best spotted play. Strong uses the same heuristic and checks close calls against 16 shared draws and modeled opponent replies, with an estimate in the panel when the full comparison favors swapping. If the comparison hits a search limit, it uses the heuristic. Held tiles stay on the rack. **No style** uses the general exchange suggestion.
