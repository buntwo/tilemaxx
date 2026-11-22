# Playing styles

Choose a style in **Playing style** in Possible moves to see placements ranked as a **Casual**, **Word-List Learner**, or **Strong Club Player** might see them. Analyze uses the same styles for modeled opponent replies. The game's selected dictionary determines which moves are legal. The saved game rules select English, French, or Italian wordfreq data. French and Italian spellings fold accents and ligatures to match board tiles.

## Solo playing styles

In solo games, **Casual**, **Word-List Learner**, and **Strong Club Player**
rank the plays the model spots using points, word familiarity, and rack
leave. The solo versions evaluate your own board and rack.

- **Greedy Bingo** takes a bingo when available and ranks placements by the
  chance of a legal bingo after you refill. The check uses the resulting board,
  including letters you can play through.
- **Triple Play** ranks by your score now plus expected points on your next
  two turns. It screens promising scores and leaves, then checks the second
  future turn for up to six finalists. It plays the highest-scoring simulated
  first move, breaking ties by rack leave, before drawing again.

Choose **Run Greedy Bingo** or **Run Triple Play** to start. Both share sampled
refills across candidates and count every possible draw order with up to two
tiles in the bag. Use **Utility breakdown** for an individual recommendation.
If the search pauses, **Run another 10 seconds** continues it.

## Bingo Mercenary

Choose **Bingo Mercenary** in Possible moves and select **Run Bingo Mercenary** for the current position. While Bingo Mercenary stays selected, a new **Find moves** search in the same game starts it automatically. The progress counter shows the stage number followed by the number of moves checked. Utility adds 75% of the current score for an ordinary play or the full score for a bingo, plus the average score of the best legal bingo on the following turn. The current score already includes any bingo bonus. Each future turn without a bingo contributes zero. Each run has a 10-second budget. **Run another 10 seconds** resumes the same search, keeping completed deals and any provisional rankings.

The search screens up to 96 placements drawn from high-scoring plays, promising leaves, premium-square lanes, and immediate bingos. The board-first shortlist gets up to 20 slots. A shallow opponent-reply check, premium lanes, and the highest bingos found can add candidates for a total of up to 36. The highest bingos found also earn places in deeper analysis. The reply model picks the highest score plus rack-leave value and passes when there is no legal placement. Finalists receive up to 512 shared deals, with a checkpoint at 256. Exact searches can expand beyond the usual shortlist when they fit the work limit. The utility breakdown shows the number of deals checked, the chance of a bingo after the reply, its average score when available, and the highest bingo found.

Once the sampled ranking is ready, **Run another 10 seconds** checks **High-ceiling setups** without reordering the main results. This pass enumerates small refill pools, looks up words in promising premium lanes for larger pools, and checks reply-created lanes for small pools with one-tile refills. It can show up to six setups for 100-point or higher bingos. Each setup shows the draw and the chance of scoring that bingo after the modeled reply. The opponent's lane and blocking odds are conditional on that draw. A reply that supplies a board letter can open a bingo that was unavailable after your setup alone.

## Bingo Tactician

Select **Bingo Tactician** and choose **Run Bingo Tactician**. It uses the same opponent reply model and current-play weights as Bingo Mercenary. It subtracts the expected opponent reply score and credits 75% of the expected best ordinary follow-up score on deals without a bingo. Deals that end the game earn no follow-up credit. Up to five finalists receive ordinary follow-up analysis.

Bingo Tactician also scores the change in usable bingo lanes across four shared replies. It gives more credit to windows with flexible cross-checks, including plays through existing letters. The lane change is weighted by 8 at a next-turn bingo chance of 10% or lower across the best finalist. The weight tapers to zero at 40%. The lane term applies with at least 12 tiles in the bag and is capped at 10 points in either direction.

Both styles enumerate exact tile deals with up to two tiles in the bag and sample deals with three or more. They run on demand in 10-second slices and keep their rankings separate. Once a style has run in a game, it starts again on new **Find moves** searches while selected. Use the **Utility breakdown** to see which terms apply to each recommendation.

## Master

Choose **Master** in **Playing style** and select **Run Master**. The progress counter shows how many candidates it has checked. Once you have run it in a game, new **Find moves** searches run Master again while it stays selected.

Master starts with score and rack leave to find up to 12 placements worth testing. It samples the opposing rack and bag without replacement and reuses the same deals across candidates. For each deal, it models the opponent’s reply and your following turn. It gives full credit to the current score, subtracts the opponent’s reply and leave, then adds 65% of your follow-up score and leave and 35% of your current leave. Finished deals use the actual points and final rack adjustments.

Master screens with eight shared deals and checks up to four finalists with 40 shared deals. With up to two tiles in the bag it enumerates their possible orders and weights them by multiplicity. With an empty bag and up to ten tiles across the racks, it also searches a shortlist of known-rack endgames, including passing when allowed. The **Utility breakdown** shows the terms and sample count or the exact swing of the checked line. Each run has a 10-second limit and can resume if a sampling phase needs more time.

## How the model works

1. **Spot moves.** Each simulated player has a seeded vocabulary that stays consistent across turns. The player looks at a fraction of available board locations. Long placements and assigning blanks are harder to spot. Vertical words are harder for Casual to recognize, with a smaller effect for Learner and Strong. Learner and Strong also recall more short study words and bingos with likely letter combinations. Every new cross word still has to be familiar.
2. **Rank the moves.** Utility adds weighted points, visible premiums, rack value, and any tactical adjustment. The hardest spelling, the number of cross words, and the number of tiles placed beyond five contribute small costs. Rack value rewards keeping flexible tiles and shedding awkward duplicates or excess vowels and consonants. With an empty bag, the rack term switches to the face-value liability of leftover tiles. Going out has a fixed incentive for Casual and Learner. Strong estimates the actual transfer from the known opposing rack.
3. **Check the leading candidates.** Casual uses the static ranking. Learner checks three finalists for premium lanes using board geometry and letter availability. Strong checks up to five for both lanes and single-tile premium hooks. With an empty bag and at most seven tiles across both racks, Strong can compare up to five spotted placements by searching the known-rack continuation. Redundant immediate rack-outs share one shortlist slot. A finished search replaces the static rack projection with the spread from the line. If the shortlist exceeds the 8 ms budget or a candidate reaches 96 searched positions, the static ranking applies.

[Word familiarity](../shared/word-familiarity.ts) starts from exact wordfreq spellings with a Zipf 3 cutoff. Spellings absent from wordfreq use capped edit distance from up to 10,000 common legal spellings. The [profile weights](../shared/player-profiles.ts) reduce that difficulty for studied words based on length and the tile combinations available in the starting distribution. Each spelling still gets its own vocabulary roll, even when two words are anagrams. In Analyze, the same simulated opponent has consistent vocabulary across compared boards.

### Research behind the model

- Novice–expert studies find differences in Scrabble-specific anagramming, board-pattern recognition and vertical word recognition. The studies support modeling these skills separately from general English familiarity. The model's exact coefficients come from testing, since these studies did not measure move-discovery probabilities. [Halpern and Wai](https://cdn2.psychologytoday.com/assets/attachments/56143/the-world-competitive-scrabble.pdf), [Hargreaves et al.](https://link.springer.com/article/10.3758/s13421-011-0137-5), [Tuffiash et al.](https://pubmed.ncbi.nlm.nih.gov/17924798/)
- NASPA introduces beginners to twos and threes. Scrabble New Zealand's training guide also recommends studying hooks and high-probability bingo racks, balancing the rack, and spending more thought on the endgame. [NASPA director manual](https://scrabbleplayers.org/dirman/dirman-20130721.pdf), [Scrabble New Zealand](https://scrabble.org.nz/resources/16-tips-to-boost-your-scrabble-game/)
- Scrabble AI research motivates adding score and rack quality before more expensive search and using unseen tiles to screen defense. [Richards and Amir](https://ijcai.org/proceedings/2007/239), [Agarwal](https://arxiv.org/abs/1901.08728), [Tibshirani](https://arxiv.org/abs/1107.2456)

## Premium threats

The lane adjustment uses the largest increase in two-premium risk. Strong weights that change three times as much as Learner. The lane check uses rack capacity, perpendicular word constraints, unseen tiles, and the value of letters a reply would play through. Triple- and quadruple-word squares count as major premiums. Strong also checks one-tile hooks onto major word and letter premiums and discounts threats when the needed tile is scarce.

## Exchange suggestions

When a style chooses to exchange, **Swap** in Possible moves marks those tiles and opens **Simulate exchange**. Casual and Word-List Learner use rack quality to compare swaps with the style’s best spotted play. If Casual’s first swap would discard every copy of a useful duplicate, it also considers a smaller swap that keeps one copy. Strong uses the same heuristic and checks close calls against 16 shared draws and modeled opponent replies, with an estimate in the panel when the full comparison favors swapping. If the comparison hits a search limit, it uses the heuristic. Held tiles stay on the rack. **No style** uses the general exchange suggestion.
