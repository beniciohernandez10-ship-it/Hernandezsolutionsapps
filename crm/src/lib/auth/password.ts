import bcrypt from "bcryptjs";

export const PASSWORD_MIN = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > 200) return "That password is too long.";
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase())) return "Don't include your email name in the password.";
  if (/^(.)\1+$/.test(password)) return "Pick a less predictable password.";
  return null;
}

let dummyHash: string | null = null;
/** Compare against a throwaway hash so unknown emails take as long as real ones. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= await bcrypt.hash("never-a-real-password", 12);
  await bcrypt.compare(password, dummyHash);
}
