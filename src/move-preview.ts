export function canHoverWithMouse(pointerType: string) {
  return pointerType === "mouse" && matchMedia("(any-hover: hover)").matches;
}

export function shouldPlayMove(clickCount: number, pointerType: string, pinned: boolean) {
  return (clickCount > 0 && canHoverWithMouse(pointerType)) || pinned;
}
