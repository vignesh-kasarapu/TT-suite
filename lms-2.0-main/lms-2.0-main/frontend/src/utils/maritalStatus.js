/** Marital status choices for the Edit employee and Edit profile dropdowns. A value saved
 * before the dropdown existed (free text) is kept as an extra option, so opening and saving
 * the form never changes it silently. */
export const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'];

export const maritalOptions = (current) => (
  current && !MARITAL_STATUSES.some((s) => s.toLowerCase() === current.toLowerCase())
    ? [...MARITAL_STATUSES, current]
    : MARITAL_STATUSES
);

/** Matches a stored value to its dropdown spelling ("married" -> "Married"). */
export const normaliseMarital = (value) => (
  MARITAL_STATUSES.find((s) => s.toLowerCase() === (value || '').trim().toLowerCase()) || value || ''
);
