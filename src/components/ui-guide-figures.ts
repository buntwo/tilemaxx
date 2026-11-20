import workspace from "../assets/ui-guide/game-workspace.webp";
import phone from "../assets/ui-guide/phone-preview.webp";
import moves from "../assets/ui-guide/possible-moves.webp";
import analysis from "../assets/ui-guide/move-analysis.webp";
import scores from "../assets/ui-guide/game-scores.webp";

export type GuideFigure = {
  tab: string;
  title: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  labels: { x: number; y: number; name: string; hint: string }[];
};

// Marker coordinates are in the original screenshot pixels.
export const guideFigures: GuideFigure[] = [
  {
    tab: "Workspace",
    title: "Game workspace on desktop",
    src: workspace,
    width: 1440,
    height: 898,
    alt: "Practice game with the sidebar, board, rack, and possible moves visible together.",
    labels: [
      {
        x: 205,
        y: 201,
        name: "Sidebar",
        hint: "Open other games, settings, or this guide.",
      },
      {
        x: 471,
        y: 35,
        name: "Game header",
        hint: "Find the game name, platform, word list, and centered score.",
      },
      {
        x: 1312,
        y: 36,
        name: "Game options",
        hint: "See the word list and notes, or edit, duplicate, or archive the game.",
      },
      {
        x: 249,
        y: 273,
        name: "Game board",
        hint: "Enter tiles or see where a suggested play lands.",
      },
      {
        x: 645,
        y: 701,
        name: "Board control strip",
        hint: "Check the selected square, mark blanks, erase, undo, or redo.",
      },
      {
        x: 345,
        y: 762,
        name: "Your rack",
        hint: "Enter the tiles you can play.",
      },
      {
        x: 388,
        y: 858,
        name: "Unseen tiles",
        hint: "Check tiles that could be in the bag or on other racks.",
      },
      {
        x: 1085,
        y: 95,
        name: "Possible moves",
        hint: "Browse, sort, and analyze the legal plays.",
      },
    ],
  },
  {
    tab: "Phone",
    title: "Move preview on a phone",
    src: phone,
    width: 390,
    height: 810,
    alt: "A selected JILT move is previewed on the phone board, with the rack to its right and the move list below.",
    labels: [
      {
        x: 54,
        y: 27,
        name: "Sidebar",
        hint: "Tap Open sidebar to find the UI guide and other screens.",
      },
      {
        x: 147,
        y: 222,
        name: "Move preview",
        hint: "The shaded tiles show where the selected play goes.",
      },
      {
        x: 124,
        y: 413,
        name: "Preview bar",
        hint: "The word and its score are directly below the board.",
      },
      {
        x: 290,
        y: 415,
        name: "Play",
        hint: "Put the previewed move on the board.",
      },
      {
        x: 342,
        y: 172,
        name: "Your rack",
        hint: "The rack moves beside the board while you preview. In an endgame, the opponent’s tiles stack below yours.",
      },
      {
        x: 128,
        y: 596,
        name: "Move row",
        hint: "Tap a suggestion to preview it.",
      },
    ],
  },
  {
    tab: "Possible moves",
    title: "Move list and Reply details",
    src: moves,
    width: 546,
    height: 713,
    alt: "The move list with JANTY selected and the Reply after JANTY box below it.",
    labels: [
      {
        x: 187,
        y: 39,
        name: "Possible moves",
        hint: "The results panel reads Possible moves - Endgame when the bag is empty.",
      },
      {
        x: 182,
        y: 75,
        name: "Move filters",
        hint: "Switch between All moves and Shortlist, or filter by word or square.",
      },
      {
        x: 464,
        y: 37,
        name: "Analyze",
        hint: "Open Move analysis to compare candidates.",
      },
      {
        x: 339,
        y: 105,
        name: "Reply delta",
        hint: "A positive number means a higher-scoring reply for the opponent.",
      },
      {
        x: 183,
        y: 210,
        name: "Move row",
        hint: "An individual suggestion with its score, leave, and position.",
      },
      {
        x: 458,
        y: 222,
        name: "Bingo odds",
        hint: "The draw and board-based chances shown beneath the leave.",
      },
      {
        x: 153,
        y: 508,
        name: "Reply details",
        hint: "The box headed Reply after the selected move.",
      },
      {
        x: 332,
        y: 598,
        name: "Reply distribution",
        hint: "Compare how often each range of opponent scores occurs.",
      },
      {
        x: 84,
        y: 677,
        name: "Reply heatmap",
        hint: "Open a board view of where the opponent’s strongest replies land.",
      },
    ],
  },
  {
    tab: "Move analysis",
    title: "Move comparison and optimal endgame line",
    src: analysis,
    width: 496,
    height: 916,
    alt: "Two moves compared in an empty-bag position, with the details and optimal line expanded for ZA.",
    labels: [
      {
        x: 183,
        y: 71,
        name: "Analysis candidates",
        hint: "These are the moves selected for comparison.",
      },
      {
        x: 306,
        y: 132,
        name: "Run analysis",
        hint: "Start the comparison. After it runs, this becomes Refine estimates.",
      },
      {
        x: 225,
        y: 189,
        name: "Endgame budget",
        hint: "Set how much work the exact search can do per move.",
      },
      {
        x: 129,
        y: 285,
        name: "Move comparison",
        hint: "Compare the candidates by score, threats, swing, and final result.",
      },
      {
        x: 342,
        y: 295,
        name: "Reference move",
        hint: "The first candidate is the baseline for relative comparisons.",
      },
      {
        x: 173,
        y: 690,
        name: "Move analysis details",
        hint: "Expand a move to see its individual results.",
      },
      {
        x: 336,
        y: 772,
        name: "Optimal endgame line",
        hint: "Read the exact sequence of moves for both players.",
      },
    ],
  },
  {
    tab: "Game scores",
    title: "Game scores and tracked move history",
    src: scores,
    width: 654,
    height: 630,
    alt: "The two score totals and a six-turn history with a bingo trophy on TORMENT.",
    labels: [
      {
        x: 139,
        y: 36,
        name: "Game scores",
        hint: "See both totals and your current lead, deficit, or final result.",
      },
      {
        x: 205,
        y: 231,
        name: "Tracked move history",
        hint: "Open a list of scored turns for both players.",
      },
      {
        x: 117,
        y: 332,
        name: "Turn review",
        hint: "Select a word to replay that turn with its saved board and rack.",
      },
      {
        x: 360,
        y: 405,
        name: "Bingo trophy",
        hint: "Gold and a trophy identify a bingo.",
      },
      {
        x: 139,
        y: 185,
        name: "Review game",
        hint: "Look for missed opportunities across the game.",
      },
    ],
  },
];
