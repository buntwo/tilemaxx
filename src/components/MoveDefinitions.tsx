import { createContext, useContext, useId, type ReactNode } from "react";
import { definitionLanguageForRules } from "../../shared/definitions";
import type { Rules } from "../../shared/model";
import { useMoveDefinitions } from "./useMoveDefinitions";

const MoveDefinitionContext = createContext<ReturnType<typeof useMoveDefinitions> | null>(null);

export function useMoveDefinitionContext() {
  return useContext(MoveDefinitionContext);
}

export function MoveDefinitions({ rules, position, phoneLayout, children }: {
  rules?: Rules;
  position: unknown;
  phoneLayout: boolean;
  children: ReactNode;
}) {
  const definitions = useMoveDefinitions(
    rules ? definitionLanguageForRules(rules) : undefined,
    position,
    phoneLayout,
  );
  return (
    <MoveDefinitionContext.Provider value={definitions}>
      {children}
      {definitions.popup}
    </MoveDefinitionContext.Provider>
  );
}

export function DefinitionWord({ word, children = word, className }: {
  word: string;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const definitions = useMoveDefinitionContext();
  if (!definitions?.available && !className) return children;
  return (
    <span
      className={className}
      {...definitions?.wordProps(word, id)}
      aria-describedby={definitions?.descriptionId(id)}
      title={definitions?.available ? "" : undefined}
    >
      {children}
    </span>
  );
}
