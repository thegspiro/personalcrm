import "server-only";
import bcrypt from "bcryptjs";

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export interface PasswordCheck {
  ok: boolean;
  problems: string[];
}

export function checkPasswordStrength(plain: string): PasswordCheck {
  const problems: string[] = [];
  if (plain.length < 10) problems.push("Use at least 10 characters.");
  if (!/[a-zA-Z]/.test(plain)) problems.push("Include at least one letter.");
  if (!/[0-9\W]/.test(plain)) problems.push("Include at least one number or symbol.");
  return { ok: problems.length === 0, problems };
}
