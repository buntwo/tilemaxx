# Tilemaxx HTTP API

The API controls the same saved workspace as the web app. It can manage games,
profiles, board templates and word lists, enter and score plays, recognize
screenshots, and run move, exchange, endgame and review analysis.

## Enable access

Generate two independent secrets with `openssl rand -hex 32`. Set one as
`TILEMAXX_API_TOKEN` and the other as `TILEMAXX_WEB_PASSWORD` in the Tilemaxx
server environment. Both must be distinct 64-character hex strings. Startup
rejects incomplete or invalid configuration. With neither variable set, the
versioned API is disabled and the existing trusted-LAN web app works as before.

For a Compose install, add both values to the deployment's local `.env` file
and add the following entries under `environment:` in the local
`compose.yaml`.

```yaml
TILEMAXX_API_TOKEN: ${TILEMAXX_API_TOKEN:?Set the Tilemaxx API token}
TILEMAXX_WEB_PASSWORD: ${TILEMAXX_WEB_PASSWORD:?Set the Tilemaxx browser password}
```

Recreate the container with `docker compose up -d`. Use the browser's sign-in
prompt with username `tilemaxx` and the web password. The browser credential
also protects the legacy web and debug API routes. On HTTPS, each browser or
installed web app stays signed in for 30 days using an HTTP-only cookie. Sign in
once on each device or browser profile. Clearing the site's cookies or rotating
the web password ends the remembered sign-in. `GET /api/health` stays available
for the container health check and returns only a status flag.

Give API clients the bearer token through their local secret store or
environment. Each credential grants full access to all profiles on the
instance. Rotate a credential by replacing its value and restarting Tilemaxx.
Use HTTPS through a reverse proxy on the trusted network, or a private VPN
that encrypts the connection to the server. Keep the Tilemaxx port off the
public internet. HTTP sends both types of credential in a recoverable form.

## Make a request

```sh
export TILEMAXX_URL=https://tilemaxx.example
curl -fsS -H "Authorization: Bearer ${TILEMAXX_API_TOKEN}" \
  "${TILEMAXX_URL}/api/v1/state/index"
```

The examples below use paths relative to `/api/v1`. Send
`Authorization: Bearer <token>` with every request and
`Content-Type: application/json` with JSON bodies. Use `{}` for writes with
no fields. `GET /health` checks your token and reports the app version.
`GET /schema` returns JSON Schemas for the structured request bodies, keyed
by method and path. Rules such as matching a board array to the template size
are additionally checked at runtime.

## Workspace data

| Request | Purpose |
| --- | --- |
| `GET /state/index` | Get profiles, templates, word lists, and compact active and archived game summaries. |
| `GET /state` | Get the workspace with every full game. Prefer the index for polling. |
| `GET /games/:id` | Read a full game, including its current revision, position and history. |
| `POST /games/new` | Create a game with `profileId`, `templateId`, and `name`. Optional fields include `dictionaryId`, `language`, `solo`, `trackScores`, `platform`, `startedOn`, and `notes`. |
| `POST /games` | Create from a full game snapshot. The server assigns its ID and revision. |
| `PUT /games/:id` | Replace a full game with the current revision. The game ID, owner profile and solo setting are fixed. |
| `POST /games/:id/actions` | Apply a game command with revision checking. |
| `POST /games/:id/archive-and-start` | Atomically archive a game and start another using `revision` and `startedOn`. |
| `POST /games/:id/rematch` · `POST /games/:id/copy` | Rematch with `startedOn`, or duplicate with an optional `name`. |
| `DELETE /games/:id` | Delete a game. |
| `GET /archive/statistics?profileId=…` | Read the profile's archived-game statistics and monthly trends. |
| `POST /profiles` · `PUT /profiles/:id` · `DELETE /profiles/:id` | Create, rename or delete with `{"name":"…"}`. Deleting requires the current exact name and also deletes that profile's games. |
| `PUT /profiles/:id/game-order` | Set `{"gameIds":[…]}` to a permutation of the profile's active games. |
| `POST /templates` · `PUT /templates/:id` · `DELETE /templates/:id` | Manage custom board templates. A new template receives a server-generated ID. |
| `GET /dictionaries/:id` · `POST /dictionaries` · `DELETE /dictionaries/:id` | Download plain text, import `{"name":"…","text":"…"}`, or remove an unused custom word list. |
| `POST /word-check` | Check up to 100 `words` against `dictionary: {"id":"…"}` or `dictionary: {"text":"…"}`. Inline lists are transient. |
| `GET /definitions?language=en&word=CAT` | Look up English or French definitions, with up to two `word` parameters. |

For retryable creation, give `POST /games/new`, `POST /games`, copy or
rematch a unique 32-character lowercase hex `creationToken`. Reuse the same
token only when retrying the same creation request.

## Play and edit a game

Read the game, then send an action with the revision you read. On success the
server returns the updated game. A `409` returns the current game in the
`game` field so you can decide whether to retry.

```json
{
  "revision": 0,
  "command": {
    "action": "rack",
    "rack": "CATERS?",
    "excludedRackSlots": [3],
    "requiredRackSlots": [6]
  }
}
```

| Command | Fields and behavior |
| --- | --- |
| `rack` · `shuffle-rack` | Set `rack` and optional rack marks, or shuffle the current rack with marks attached to their tiles. |
| `edit-board` | Supply `edits` as `[{ "index": 112, "letter": "A" }]`. An empty letter erases a tile. |
| `play` | Use a result's `tiles` and `direction`, or provide a placed word directly. Tilemaxx computes its score. Rack marks apply by default. Set `useRackMarks: false` for manual entry, or send `confirmedLeave` to record a play with a corrected rack. Optional `bagSize` confirms the tile count. |
| `record-opponent` · `reopen-opponent` · `keep-board-correction` | Record the pending play, reopen the last play recorded by search, or keep edits as a correction. Use `forSearch: true` with `record-opponent` to match what the web app does before finding moves. |
| `edit-details` | Change any of `name`, `platform`, `startedOn`, `notes`, and `dictionaryId`. |
| `import-board` | Supply a corrected `board` and optionally `premiums`. Use `layoutOnly: true` to import only the supplied layout and start with an empty board. |
| `clear-board` · `restore-premiums` | Clear board and rack, or restore the template's original premium squares. |
| `score-tracking` · `correct-score` | Set `enabled`, or correct a scored turn using `index`, `player`, `word`, and `score`. Set `insert: true` to add a missed turn. |
| `end` | End a game, optionally setting `scores` with `you` and `opponent`, a head-to-head `outcome`, and `archive`. |
| `archive` · `unarchive` · `restore-archived-position` | Archive the current snapshot, move it back to My games, or restore the originally archived position. |
| `undo` · `redo` | Step through the saved board history. |

Board and rack indices are zero-based. For a board of size `N`, an index is
`row × N + column`. Uppercase letters are natural tiles and lowercase board
letters are assigned blanks. In a rack, `?` is an unassigned blank and `.`
is an empty slot. Manual board and play entry can transcribe plays from another
game. Use the word checker or move generation to validate dictionary membership.

## Analyze a position

Send `POST /analysis` with a saved game reference or a transient position. For
a saved game, include its revision if you want to pin the analysis to what you
read. The response includes the analyzed revision in `X-Tilemaxx-Revision`.
Use a game command when you want to change the saved position.

```json
{
  "position": { "gameId": "GAME_ID", "revision": 1 },
  "operation": { "kind": "moves", "word": "CAT", "sort": "score", "offset": 0 }
}
```

A transient `position` supplies `template`, `board`, `rack`, and
`dictionaryId`, with optional `solo` and rack marks. Use move IDs returned by
the search for move-specific analysis of the same position.

| Operation `kind` | Output and options |
| --- | --- |
| `position` | Board warnings, unseen tiles, estimated bag size and optional `square` for crossing words. Saved games also return recorded score and turn information. |
| `moves` | Up to 64 rows with scores and breakdowns, filtered scores and bingo counts, and `nextOffset` when more rows are available. Filter with `word` and `squares`. Optional `sort`, `reversed`, `style`, `seed`, `sample` and bounded `budgetMs` control ranking. A Learner swap recommendation is returned as `exchangeAdvice`. |
| `compare` | Compare up to three IDs in `moves`. Optionally set `opponent` to `casual`, `learner`, or `strong`, and request `refined` sampling. |
| `reply` | Forecast the opponent's reply after `move` against an optional `reference`. Set `heatmap` or `refined` for details. |
| `endgame-line` · `opponent-endgame` | Solve a player `move` or rank lines when the opponent plays first with an empty bag. |
| `bingo-odds` · `premium-defense` | Inspect up to 20 `moves`. Add `boardBased: true` for playable bingo odds. |
| `exchange` · `optimal-exchange` · `exchange-advice` | Simulate a swap using rack `slots`, compare swap options, or ask for advice with an optional style and move. |
| `review-turn` · `review-game` | Review one tracked turn by `index` or find missed opportunities across the game. |
| `policy` · `policy-timeline` | Estimate a play's fit by turn `index`, or page through one `player`'s turns using `offset`. |

Analysis that needs bag information accepts `bagSize`, `scorelessTurns`,
and `opponentHasFinalTurn`. It defaults to a full opponent rack when enough
unseen tiles are available. The styles accepted by `moves` include the browser's
Casual, Learner, Strong, Bingo Mercenary, Bingo Tactician,
Master and solo styles. Bounded simulations can return provisional results.
Repeat with a larger supported budget for a longer search. Pagination reruns
the search, so provisional rankings may differ between requests.

## Screenshots

Send `POST /screenshots/read` with a base64 `image`, its `format`
(`png`, `jpeg`, `webp` or `heif`), the board `size`, and optionally a
pixel `crop` with `left`, `top`, `width`, and `height`. The server
returns a proposed `board`, uncertain square indices, and detected premiums.
Review them before applying the `import-board` command to a game. Image input
is limited to 15 million base64 characters and a decoded area of 32 MP.

For Wordfeud opening-score inference, send `POST /screenshots/infer-premiums`
with `template`, the corrected `board`, and observed `squares` where
`null` means unknown. The response lists possible opening sequences. Submit
again with a zero-based `sequence` and one `scores` entry per turn to
identify covered premiums from those opening scores. Use
`POST /screenshot-examples` to save a corrected recognition example.

## Errors and local browser state

Errors return an `error` string. Expect `401` for invalid credentials,
`400` or `422` for invalid input, `409` for a conflict, and `413` for a
large request. The server runs one compute-intensive request at a time. Simulated playing styles can use up to eight candidate workers.
A busy server returns `429` with `Retry-After`. A hard computation timeout
returns `504`. Allow up to 210 seconds in the HTTP client and reverse proxy for extended move analysis.

The API works with server-saved data. Theme, layout, keyboard and hover state,
offline downloads, and unsynced edits belong to each browser. Archive filters,
result navigation, and charts can be built from the returned data.
