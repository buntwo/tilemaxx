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
    height: 870,
    alt: "Practice game with the workspace menu, board, rack, and possible moves visible together.",
    labels: [
      {
        x: 205,
        y: 201,
        name: "Workspace menu",
        hint: "Open other games, settings, or this guide.",
      },
      {
        x: 471,
        y: 35,
        name: "Game header",
        hint: "Find the game name, tracked score, and word list.",
      },
      {
        x: 1283,
        y: 34,
        name: "Game options",
        hint: "Edit, duplicate, or archive the current game.",
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
        hint: "Change entry direction, mark blanks, erase, undo, or redo.",
      },
      {
        x: 345,
        y: 762,
        name: "Your rack",
        hint: "Enter the tiles you can play.",
      },
      {
        x: 388,
        y: 840,
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
        x: 55,
        y: 50,
        name: "Workspace menu",
        hint: "Tap the menu icon to find the UI guide and other screens.",
      },
      {
        x: 155,
        y: 220,
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
        x: 322,
        y: 412,
        name: "Play",
        hint: "Put the previewed move on the board.",
      },
      {
        x: 323,
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
    height: 833,
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
        y: 74,
        name: "Move filters",
        hint: "Switch between All moves and Shortlist, or filter by word or square.",
      },
      {
        x: 432,
        y: 40,
        name: "Analyze",
        hint: "Open Move analysis to compare candidates.",
      },
      {
        x: 379,
        y: 111,
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
        x: 460,
        y: 223,
        name: "Bingo odds",
        hint: "The draw and board-based chances shown beneath the leave.",
      },
      {
        x: 155,
        y: 647,
        name: "Reply details",
        hint: "The box headed Reply after the selected move.",
      },
      {
        x: 334,
        y: 685,
        name: "Reply distribution",
        hint: "Compare how often each range of opponent scores occurs.",
      },
      {
        x: 88,
        y: 798,
        name: "Reply heatmap",
        hint: "Open a board view of where the opponent’s strongest replies land.",
      },
    ],
  },
  {
    tab: "Move analysis",
    title: "Move comparison and optimal endgame line",
    src: analysis,
    width: 516,
    height: 936,
    alt: "Two moves compared in an empty-bag position, with the details and optimal line expanded for ZA.",
    labels: [
      {
        x: 222,
        y: 81,
        name: "Analysis candidates",
        hint: "These are the moves selected for comparison.",
      },
      {
        x: 338,
        y: 143,
        name: "Run analysis",
        hint: "Start the comparison. After it runs, this becomes Refine estimates.",
      },
      {
        x: 242,
        y: 198,
        name: "Endgame budget",
        hint: "Set how much work the exact search can do per move.",
      },
      {
        x: 132,
        y: 303,
        name: "Move comparison",
        hint: "Compare the candidates by score, threats, swing, and final result.",
      },
      {
        x: 356,
        y: 312,
        name: "Reference move",
        hint: "The first candidate is the baseline for relative comparisons.",
      },
      {
        x: 186,
        y: 700,
        name: "Move analysis details",
        hint: "Expand a move to see its individual results.",
      },
      {
        x: 345,
        y: 775,
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
    height: 582,
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
        y: 190,
        name: "Tracked move history",
        hint: "Open a list of scored turns for both players.",
      },
      {
        x: 130,
        y: 306,
        name: "Turn review",
        hint: "Select a word to replay that turn with its saved board and rack.",
      },
      {
        x: 372,
        y: 359,
        name: "Bingo trophy",
        hint: "Gold and a trophy identify a bingo.",
      },
      {
        x: 330,
        y: 537,
        name: "Review game",
        hint: "Look for missed opportunities across the game.",
      },
    ],
  },
];
