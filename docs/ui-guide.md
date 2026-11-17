# Tilemaxx UI guide

## Game workspace

| Name | Where to find it |
| --- | --- |
| **Sidebar** | The profile picker, game navigation, settings, UI guide, and keyboard shortcuts. Use the three-line **Open sidebar** button beside the page title or **Collapse sidebar** in the sidebar’s upper-right corner. |
| **Keyboard shortcuts** | Open the guide from the sidebar or press **?** outside text fields. **Alt / Option + R** focuses the rack. **Alt / Option + F** opens the game picker with its opponent filter focused, or focuses the filter in Archived games. |
| **Review changes** | The sidebar status for games with local and server versions. Hover or open it, then select a game to jump to its sync warning. |
| **Settings** | The gear below the theme controls, beside the version number. Control rack highlighting, animations, and automatic reloads when the server has a newer version. **Hardware info** shows the browser concurrency hint and the effective compute worker limit. Tilemaxx uses the browser hint by default. Enable **Limit compute workers to** and enter a maximum, which starts at 1. The setting applies to opponent reply histograms, automatic exact endgame lines, Solve endgame, board-based bingo odds, Optimal exchange, and policy timelines. These choices apply to this browser only. |
| **Update available** | The arrow beside the version number appears when automatic updates are off and the server has a newer version. |
| **Game header** | The game name, tracked score, and Game options at the top. A dot by the left or right score shows whose turn comes next based on the latest recorded word. After a pass or exchange, the dot updates when the next word is recorded. Open the name to use the **Game picker** and its opponent filter. |
| **Game options** | The menu beside the game name. It includes game details, duplication, **End game**, and archiving. When the board and move list are stacked, it also holds Board help, Import screenshot, and Move history. |
| **End game** | Record a final score or mark the game finished without a score. **Archive game** starts checked. **Deduct unplayed tiles** starts checked when deductions apply and is disabled otherwise. Clear **Archive game** to keep the game in **My games**, where **Undo** can resume it. |
| **Game board** | The editable letter and premium grid. With your rack entered, press **Enter** while typing on the board to find moves. The **board control strip** is the row directly below the board with the direction, blank, erase, Undo, and Redo controls. |
| **Board help** | The premium-square legend and board-entry instructions. |
| **Word score badge** | The points that appear beside a board word when you hover over a tile or hold it on a phone. |
| **Move preview** | The highlighted tiles on the board for a suggested play. The phone **preview bar** shows the word, points, and **Play** button. Tap a move on a phone or right-click it on desktop to pin its preview. Tap or click outside the move and its preview controls to clear it. |
| **Your rack** | The rack editor and Find moves button below the board. |
| **Rack tools** | Use **Exclude tiles** to hold tiles back or **Require tiles** to use them in every suggested move. Long-press a tile or press **↓** on the keyboard to cycle through excluded, required, and unmarked. Playing clears both kinds of mark, and Undo restores them. When shown, the opponent rack shares a row with Rack tools. |
| **Optimal exchange** | The button centered below your rack compares swaps while tiles remain in the bag. **Simulate exchange** shows the expected score, bingo chance, and sample plays for a swap. |
| **Opponent rack** | The inferred tiles centered directly below yours when the bag is empty. In a phone move preview both racks stack vertically beside the board. |
| **Unseen tiles** | The expandable tile counts below the racks. It includes tiles in the bag and on other racks. |
| **Game scores** | The score tracking panel with totals, lead or result, and opponent plays. **Find moves** records a scoreable opponent play before showing suggestions. Editing one of its newly placed tiles reopens that play. To add a missing tile, use **Edit last opponent move**. If you pass or exchange without searching, use **Record opponent move** before entering the next play whenever the two plays could read as one. |
| **Game finish** | The board overlay shows the adjusted final score when either player goes out in a tracked game. Select the final score in a finished or archived game to replay it. Select **View board** or press **Escape** to dismiss it and resume editing the board. |
| **Tracked move history** | The scored turn list inside Game scores. Expand it and select a word to open **Turn review**. The **Review game** button above the history opens policy timelines and missed opportunities. |
| **Policy timeline** | In **Review game**, select **Opponent plays** or **Your plays** and analyze that side’s recorded placements in chronological order. **Your plays** estimates fit from the opponent’s point of view using the board and your recorded placements. **Top 5 fit** shows how often the placement makes the scoring shortlist across racks that could supply the played tiles. **Random** shows the shortlist's share of legal placements. Highlights require at least 80% fit and at most 25% Random. Sampled turns check 95% bounds at 128, 256, 512, and 1,024 racks. Borderline marks turns where the bounds leave a highlight in question. Select a move to see each policy’s chance of choosing the exact placement on a rack that could supply the played tiles. Open **Raw policy estimates** to also factor in the chance of holding those tiles. |
| **Bingo trophy** | The gold highlight and trophy next to a bingo in the move list, analysis, or a recorded game. |
| **Move history** | The board and rack change log behind the history button. Undo and Redo step through these changes. |

## Possible moves and analysis

| Name | Where to find it |
| --- | --- |
| **Possible moves** | The results panel sits next to the board when at least 720 px of workspace is available, and below the board and racks on narrower workspaces. The heading reads **Possible moves - Endgame** when the bag count is zero. Use **×** at the top right to dismiss the results and return to **Find moves**. |
| **Solve endgame** | Available in active and archived games whenever the current position has an empty bag, including after **Find moves**, when the button sits beside **Shortlist**. Either rack can be partial. The opponent plays next. The panel ranks up to five options by swing from your perspective, worst first. The swing column includes the ply count. Select a row to preview the board and step through its optimal line in Reply details. |
| **Move filters** | The Shortlist and All moves switch, word search, and square filter above the results list. |
| **Move list** | The sortable table of suggestions. A **move row** is one suggestion, and a **column header** controls sorting. The small number at the upper left of each row is its position in the full list sorted by raw points. It stays fixed across other sorts and filters. PTS is the play’s score. The smaller number underneath is the gap from the best score available with all rack marks cleared. **Adj.** is the score minus the reply delta. The list sorts by adjusted points once the initial reply checks finish. Choose either order in the points header. It reads **ADJ. PTS** when sorting by adjusted points. |
| **Calculation timing** | Select the time below the move list for a breakdown of the initial Find moves run, including individual exact endgame solves when available. The bars behind the numbers use total elapsed time as the full-width reference. |
| **Reply delta** | The move-list number showing the change in the opponent’s reply score against the reference move. A lower opponent reply is favorable. |
| **Estimated endgame swing** | The EST. SWING column when the bag is empty. The figure measures the change in your lead. It may also name an opponent go-out threat. |
| **Reply details** | The box at the bottom of Possible moves headed **Reply after [move]**. With tiles in the bag, Tilemaxx automatically checks the top 20 moves by score plus up to two **Premium block** and two **Better leave** candidates. Use the chart icon in the reply column to **Check reply histogram** for another move. The details show the distribution, comparison, chance the reply outscores your play, and **Heatmap**. With an empty bag they show the opponent rack, immediate reply, score checkpoints, and the option to calculate the optimal endgame line when applicable. |
| **Reply settings** | The expandable bag count and endgame controls. It shows **Prior scoreless turns** for Scrabble and Words With Friends, **Prior consecutive passes** for Wordfeud and Lexulous, and **Opponent has a final turn** for Crossplay. |
| **Reply heatmap** | The board view of where strong replies land. Select a **hotspot** to see its change and sample replies. |
| **Reply risk** | Details for a premium square the move opens up or blocks. |
| **Bingo odds** | The draw and board-based odds in the move list, with controls to calculate the board-based chances. |
| **Move analysis** | The panel opened by **Analyze**. Pick **analysis candidates** and choose **Run analysis**. With an empty bag, adjust the **Endgame budget** to give each exact search more work. |
| **Move comparison** | The metric table in Move analysis. The first candidate is the **reference move** for relative comparisons. |
| **Move analysis details** | The expandable card for an individual candidate beneath Move comparison. It can show example replies, endgame swing, and final score. |
| **Optimal endgame line** | The exact sequence of plays in Move analysis details or in Reply details after **Calculate optimal endgame line**. In Reply details, each turn shows the tiles its player keeps, with a blue tile for a blank and `—` for an empty rack. |
| **Score breakdown** | The per-word and bonus scoring details for an individual play. |

## Other screens

| Name | Where to find it |
| --- | --- |
| **Archived games** | Saved games moved out of the active game list, with filters and tracked scores. The default sort shows the newest end dates first and uses the start date when no end date was recorded. |
| **Board studio** | The board template library. The **board editor** sets board size, premium squares, and tile counts. |
| **Screenshot import** | The dialog that reads a board from a picture. The **crop controls** set the grid bounds. **Premium review** checks special squares, including **Use opening play scores** when available. |
| **Word lists** | The dictionary manager in the sidebar. Each game’s selected dictionary is in the Game header. |

Green marks a favorable result or change for you. Red marks an unfavorable one. The comparison labels, signs, and lead or loss text carry the same meaning. Ties, reference values, and counts such as rack size and sample size use neutral styling. Gold marks bingos.
