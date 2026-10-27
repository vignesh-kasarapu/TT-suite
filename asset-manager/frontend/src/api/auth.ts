import { apiClient } from './client';
import type { User } from '../types';

// TT Suite: no login, password or profile-edit calls here; sign-in, sign-out and the profile
// (name) belong to the portal.

export async function getMeApi(): Promise<User> {
  const response = await apiClient.get<User>('/auth/me');
  return response.data;
}
