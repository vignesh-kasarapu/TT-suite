import { portalLogout } from './portal';

// Sign-in and sign-out belong to the TT Suite portal; the LMS has no web auth routes.
export const signOut = () => portalLogout();
