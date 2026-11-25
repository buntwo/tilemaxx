# Linguabase familiarity scores

`server/assets/linguabase-v1.csv.gz` is derived from the [full Linguabase vocabulary](https://www.linguabase.org/sample-data.html#vocabulary), published under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). It contains two columns, `word` and `familiarity_score`.

The export converts words to uppercase letter spellings by joining spaces and dashes. Scored exact spellings take precedence. Published familiarity scores are scaled to 0–100. Tilemaxx intersects the export with each game dictionary at runtime and sends the matching scores in dictionary order.
