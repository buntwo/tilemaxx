import { useState } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Eraser,
  History,
  ImagePlus,
  Pencil,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  archiveGame,
  emptyBoard,
  localDate,
  newGameFromSettings,
  remember,
  restoreArchivedGame,
  type Dictionary,
  type Game,
} from "../../shared/model";
import { resetGameScoring } from "../../shared/game-scoring";
import { CLEARED_BOARD } from "../../shared/score-recovery";
import { store } from "../store";
import { GameOptionDetails } from "./GameDetails";
import Modal from "./Modal";

type GameOptionDialog =
  | "screenshot"
  | "history"
  | "board-help"
  | "dictionaries"
  | "rename"
  | "end-game"
  | "delete";

export default function GameOptions({
  game,
  board,
  dictionaries,
  online,
  boardLocked,
  onUpdate,
  onChooseGame,
  onArchived,
  onOpen,
  onClose,
  notify,
}: {
  game: Game;
  board: string;
  dictionaries: readonly Dictionary[];
  online: boolean;
  boardLocked: boolean;
  onUpdate: (game: Game) => void;
  onChooseGame: (id: string) => void;
  onArchived: () => void;
  onOpen: (dialog: GameOptionDialog) => void;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connectionRequired = online ? undefined : "A server connection is required";

  async function openCreatedGame(create: () => Promise<Game>, message?: string) {
    setBusy(true);
    setError("");
    try {
      const created = await create();
      onChooseGame(created.id);
      onClose();
      if (message) notify(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startNewGame() {
    const today = localDate();
    if (game.archived) {
      return openCreatedGame(
        () => store.createGame(newGameFromSettings(game, today)),
        "New game started.",
      );
    }
    return openCreatedGame(
      () => store.archiveAndStartNewGame(game.id, today),
      "Game archived. New game started.",
    );
  }

  function toggleArchive() {
    onUpdate(
      game.archived
        ? { ...game, archived: false, archivedBoard: undefined, archivedState: undefined }
        : archiveGame(game),
    );
    if (!game.archived) onArchived();
    onClose();
    notify(game.archived ? "Game moved to My games." : "Game archived.");
  }

  return (
    <Modal
      title="Game options"
      subtitle={game.name}
      className="game-options-modal"
      focusTitle
      onClose={onClose}
      closeDisabled={busy}
    >
      <div aria-busy={busy}>
        <div className="game-option-groups">
          <section aria-labelledby="game-option-board">
            <h3 id="game-option-board">Board tools</h3>
            <div className="game-option-list">
              <button
                disabled={busy || boardLocked}
                onClick={() => onOpen("screenshot")}
              >
                <ImagePlus size={17} aria-hidden="true" /> Import screenshot
              </button>
              <button disabled={busy} onClick={() => onOpen("history")}>
                <History size={17} aria-hidden="true" /> Move history
              </button>
              <button disabled={busy} onClick={() => onOpen("board-help")}>
                <CircleHelp size={17} aria-hidden="true" /> Board help
              </button>
            </div>
          </section>
          <section className="game-option-info" aria-labelledby="game-option-info">
            <h3 id="game-option-info">Game details</h3>
            <GameOptionDetails
              game={game}
              board={board}
              dictionaries={dictionaries}
              disabled={busy}
              onChooseDictionary={(dictionaryId) =>
                onUpdate({ ...game, dictionaryId })
              }
              onAboutWordLists={() => onOpen("dictionaries")}
            />
            <button
              className="game-option-edit"
              disabled={busy}
              onClick={() => onOpen("rename")}
            >
              <Pencil size={15} aria-hidden="true" /> Edit game details
            </button>
          </section>
        </div>
        <details className="game-option-manage">
          <summary>
            Manage game
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <div className="game-option-list">
            {game.archived && (
              <button
                disabled={busy || !online}
                title={connectionRequired}
                onClick={() => void startNewGame()}
              >
                <Plus size={17} aria-hidden="true" />
                <span>
                  Start new game
                  <small>Same opponent and settings, starting today</small>
                </span>
              </button>
            )}
            {game.archived ? (
              <button
                disabled={busy || boardLocked || !game.archivedBoard}
                onClick={() => {
                  onUpdate(restoreArchivedGame(game));
                  onClose();
                  notify(
                    game.archivedState
                      ? "Archived position restored."
                      : "Archived board restored.",
                  );
                }}
              >
                <Undo2 size={17} aria-hidden="true" /> Restore game
              </button>
            ) : !game.scoring?.end && (
              <button disabled={busy} onClick={() => onOpen("end-game")}>
                <Check size={17} aria-hidden="true" /> End game
              </button>
            )}
            <button disabled={busy} onClick={toggleArchive}>
              <Archive size={17} aria-hidden="true" />
              {game.archived ? "Move to My games" : "Archive game"}
            </button>
            {!game.archived && (
              <button
                disabled={busy || !online}
                title={connectionRequired}
                onClick={() => void startNewGame()}
              >
                <Plus size={17} aria-hidden="true" /> Archive &amp; start new game
              </button>
            )}
            <button
              disabled={busy || !online}
              title={connectionRequired}
              onClick={() =>
                void openCreatedGame(() =>
                  store.createGame({
                    ...game,
                    name: `${game.name.slice(0, 65)} (copy)`,
                    archived: false,
                    archivedBoard: undefined,
                    archivedState: undefined,
                  }),
                )
              }
            >
              <Copy size={17} aria-hidden="true" /> Duplicate game
            </button>
          </div>
          <div className="game-option-list game-option-reset">
            <button
              disabled={busy || boardLocked}
              onClick={() => {
                onUpdate({
                  ...game,
                  ...remember(game, CLEARED_BOARD),
                  scoring: resetGameScoring(game),
                  board: emptyBoard(game.template.size),
                  rack: "",
                  excludedRackSlots: undefined,
                  requiredRackSlots: undefined,
                });
                onClose();
                notify("Board cleared. Use Undo to restore it.");
              }}
            >
              <Eraser size={17} aria-hidden="true" />
              <span>Clear board and rack<small>Can be undone</small></span>
            </button>
            <button
              className="game-option-danger"
              disabled={busy}
              onClick={() => onOpen("delete")}
            >
              <Trash2 size={17} aria-hidden="true" />
              <span>Delete game<small>Permanently removes the game and history</small></span>
            </button>
          </div>
        </details>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </Modal>
  );
}
