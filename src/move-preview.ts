export function canHoverWithMouse(pointerType: string) {
  return pointerType === "mouse" && matchMedia("(any-hover: hover)").matches;
}
