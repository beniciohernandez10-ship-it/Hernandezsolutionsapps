export type RoleKey = "OWNER" | "ADMIN" | "SALES" | "VIEWER";

const RANK: Record<RoleKey, number> = { VIEWER: 1, SALES: 2, ADMIN: 3, OWNER: 4 };

export function hasRole(role: RoleKey, min: RoleKey): boolean {
  return RANK[role] >= RANK[min];
}

export const canWrite = (role: RoleKey) => hasRole(role, "SALES");
export const canAdmin = (role: RoleKey) => hasRole(role, "ADMIN");
