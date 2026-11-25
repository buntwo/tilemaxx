import type { MouseEvent, PointerEvent } from "react";
import type { DefinitionLanguage } from "../../shared/definitions";
import { canHoverWithMouse } from "../move-preview";
import { useDefinitionHold } from "../useDefinitionHold";
import { useDefinitionTooltip } from "./DefinitionTooltip";

export function useMoveDefinitions(
  language: DefinitionLanguage | undefined,
  position: unknown,
  phoneLayout: boolean,
) {
  const mouse = !!language && canHoverWithMouse("mouse");
  const touch = !!language && phoneLayout;
  const hold = useDefinitionHold(touch, position);
  const available = mouse || touch;
  const definitions = useDefinitionTooltip(
    available ? language : undefined,
    position,
    hold.locked,
  );

  return {
    available,
    mouse,
    touch,
    anchor: definitions.anchor,
    popup: definitions.popup,
    ownsContextMenu: hold.ownsContextMenu,
    descriptionId(id: string) {
      return definitions.anchor?.dataset.moveId === id ? definitions.id : undefined;
    },
    wordProps(word: string, id: string) {
      return {
        "data-move-id": available ? id : undefined,
        "data-definition-hold": touch || undefined,
        onPointerDown: touch ? (event: PointerEvent<HTMLElement>) => {
          hold.start(event, (anchor) => definitions.openSheet(anchor, [{ word }], word));
        } : undefined,
        onContextMenu: touch ? (event: MouseEvent<HTMLElement>) => {
          if (hold.ownsContextMenu(event.target)) {
            event.preventDefault();
            event.stopPropagation();
          }
        } : undefined,
        onPointerEnter: mouse ? (event: PointerEvent<HTMLElement>) => {
          if (event.pointerType === "mouse" && event.buttons === 0)
            definitions.hover(event.currentTarget, word);
        } : undefined,
        onPointerLeave: mouse ? (event: PointerEvent<HTMLElement>) => {
          if (event.pointerType === "mouse") definitions.leave();
        } : undefined,
      };
    },
  };
}
