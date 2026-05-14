export const MIN_PASSWORD_LENGTH = 8;

/** Returns an error message string, or null if the password is valid. */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}
