import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const RegisterCalculation = createContext<(() => () => void) | null>(null);
const GameCalculating = createContext(false);

export function GameCalculations({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(0);
  const register = useCallback(() => {
    setRunning((count) => count + 1);
    return () => setRunning((count) => count - 1);
  }, []);
  return (
    <RegisterCalculation.Provider value={register}>
      <GameCalculating.Provider value={running > 0}>
        {children}
      </GameCalculating.Provider>
    </RegisterCalculation.Provider>
  );
}

export function useGameCalculation(pending: boolean) {
  const register = useContext(RegisterCalculation);
  useEffect(() => (pending ? register?.() : undefined), [pending, register]);
}

export function useGameCalculating() {
  return useContext(GameCalculating);
}
