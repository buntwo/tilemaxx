import { useCallback, useEffect, useEffectEvent, useState, type MouseEvent } from "react";

const workspacePaths = {
  games: "/games",
  archive: "/archived-games",
  stats: "/stats",
  studio: "/board-studio",
} as const;
export type Workspace = keyof typeof workspacePaths;

const toolNames = {
  dictionaries: "word-lists",
  "word-list-checker": "word-list-checker",
  "ui-guide": "ui-guide",
  "keyboard-shortcuts": "keyboard-shortcuts",
  help: "use-on-another-device",
  "workspace-settings": "settings",
} as const;
export type WorkspaceTool = keyof typeof toolNames;
export type StatsView = { platform?: string; language?: string; year?: string; metric?: string };

type Route = {
  workspace: Workspace;
  gameId?: string;
  profileId?: string;
  move?: number;
  review?: number | null;
  sort?: "opponent";
  archiveQuery?: string;
  stats?: StatsView;
  template?: string;
  tool?: WorkspaceTool;
  guide?: string;
  wordList?: string;
};

function moveNumber(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

function readRoute(): Route {
  const path = location.pathname.replace(/\/$/, "");
  const legacyPath = !path ? `/${location.hash.slice(1)}` : "";
  const workspace = (Object.keys(workspacePaths) as Workspace[]).find(
    (key) => workspacePaths[key] === (path || legacyPath),
  ) ?? "games";
  const gameSegment = /^\/games\/([^/]+)$/.exec(path)?.[1];
  let gameId = gameSegment;
  if (gameSegment) {
    try {
      gameId = decodeURIComponent(gameSegment);
    } catch {}
  }
  const params = new URLSearchParams(location.search);
  const move = gameId ? moveNumber(params.get("move")) : undefined;
  const reviewParam = params.get("review");
  const review = reviewParam === "game" ? null : moveNumber(reviewParam) || undefined;
  const tool = (Object.keys(toolNames) as WorkspaceTool[]).find(
    (key) => toolNames[key] === params.get("tool"),
  );
  return {
    workspace,
    gameId,
    profileId: params.get("profile") || undefined,
    move,
    review: gameId && move === undefined ? review : undefined,
    sort: workspace === "archive" && params.get("sort") === "opponent" ? "opponent" : undefined,
    archiveQuery: workspace === "archive" ? params.get("q") || undefined : undefined,
    stats: workspace === "stats" ? {
      platform: params.get("platform") || undefined,
      language: params.get("language") || undefined,
      year: params.get("year") || undefined,
      metric: params.get("metric") || undefined,
    } : undefined,
    template: workspace === "studio" ? params.get("template") || undefined : undefined,
    tool,
    guide: tool === "ui-guide" ? params.get("view") || undefined : undefined,
    wordList: tool === "word-list-checker" ? params.get("list") || undefined : undefined,
  };
}

export function routeHref({ workspace, gameId, profileId, move, review, sort, archiveQuery, stats, template, tool, guide, wordList }: Route) {
  const params = new URLSearchParams();
  if (gameId && move !== undefined) params.set("move", String(move));
  else if (gameId && review !== undefined) params.set("review", review === null ? "game" : String(review));
  if (!gameId && profileId) params.set("profile", profileId);
  if (sort) params.set("sort", sort);
  if (workspace === "archive" && archiveQuery) params.set("q", archiveQuery);
  if (stats?.platform) params.set("platform", stats.platform);
  if (stats?.language) params.set("language", stats.language);
  if (stats?.year) params.set("year", stats.year);
  if (stats?.metric) params.set("metric", stats.metric);
  if (template) params.set("template", template);
  if (tool) params.set("tool", toolNames[tool]);
  if (tool === "ui-guide" && guide) params.set("view", guide);
  if (tool === "word-list-checker" && wordList) params.set("list", wordList);
  const path = workspacePaths[workspace] + (gameId ? `/${encodeURIComponent(gameId)}` : "");
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

function overlay(route: Route) {
  if (route.tool) return "tool";
  if (route.review !== undefined) return "review";
  if (route.template) return "template";
}

export function followRoute(event: MouseEvent<HTMLAnchorElement>, navigate: () => void) {
  if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey ||
    event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate();
}

export function useNavigation(onRestore: () => void) {
  const [route, setRoute] = useState(readRoute);
  const restored = useEffectEvent(onRestore);
  useEffect(() => {
    function restore() {
      setRoute(readRoute());
      restored();
    }
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", restore);
    };
  }, []);

  const navigate = useCallback((next: Route, replace = false) => {
    const href = routeHref(next);
    if (href === location.pathname + location.search + location.hash) return;
    if (replace) history.replaceState(history.state, "", href);
    else {
      const nextOverlay = overlay(next);
      const priorDepth = history.state?.tilemaxxOverlayDepth ?? 0;
      // A direct link may be the first entry in the tab, with no workspace to return to.
      const depth = nextOverlay === overlay(readRoute()) ? (priorDepth ? priorDepth + 1 : 0) : 1;
      const state = nextOverlay && depth ? { tilemaxxOverlayDepth: depth } : null;
      history.pushState(state, "", href);
    }
    setRoute(next);
  }, []);
  function closeOverlay(next: Route) {
    const depth = history.state?.tilemaxxOverlayDepth;
    if (depth) history.go(-depth);
    else navigate(next, true);
  }
  return { route, navigate, closeOverlay };
}
