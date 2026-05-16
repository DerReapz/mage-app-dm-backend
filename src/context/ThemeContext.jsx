import { createContext, useContext, useState } from 'react';

export const THEMES = {
  dark: {
    bg: '#080808', card: '#0e0e0e', surface: '#120f0a',
    border: '#c8a84b33', gold: '#c8a84b', goldDim: '#c8a84b88', goldFaint: '#c8a84b2a',
    text: '#e8d9b0', textDim: '#b8a880', muted: '#8a7a60',
    purple: '#c4a0e8', teal: '#5cad8f', red: '#c03030', blue: '#7ab8c8',
  },
};

const Ctx = createContext({ G: THEMES.dark, setTheme: () => {} });

export const useTheme    = () => useContext(Ctx).G;
export const useSetTheme = () => useContext(Ctx).setTheme;

export function ThemeProvider({ children }) {
  const [G, setG] = useState(THEMES.dark);
  return <Ctx.Provider value={{ G, setTheme: setG }}>{children}</Ctx.Provider>;
}
