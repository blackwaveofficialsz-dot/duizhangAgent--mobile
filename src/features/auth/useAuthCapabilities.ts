import { useEffect, useState } from 'react';
import { getAuthCapabilities } from '@/services/api/auth';
import type { AuthCapabilities } from '@/services/api/auth';

export type AuthCapabilitiesState = {
  status: 'loading' | 'ready' | 'error';
  capabilities: AuthCapabilities | null;
};

export function useAuthCapabilities(): AuthCapabilitiesState {
  const [state, setState] = useState<AuthCapabilitiesState>({ status: 'loading', capabilities: null });

  useEffect(() => {
    let active = true;

    void getAuthCapabilities().then(
      (capabilities) => {
        if (active) setState({ status: 'ready', capabilities });
      },
      () => {
        if (active) setState({ status: 'error', capabilities: null });
      },
    );

    return () => { active = false; };
  }, []);

  return state;
}
