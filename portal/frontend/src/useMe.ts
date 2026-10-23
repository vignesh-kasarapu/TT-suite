import { createContext, useContext } from 'react';
import type { Me } from './api';

export type MeState = { me: Me; setMe: (me: Me) => void };
export const MeContext = createContext<MeState | null>(null);

export function useMe(): MeState {
  const value = useContext(MeContext);
  if (!value) throw new Error('useMe outside the signed-in shell');
  return value;
}
