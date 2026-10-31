import { customAlphabet } from "nanoid";

const lower = "abcdefghijklmnopqrstuvwxyz0123456789";
const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const newId = () => customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 14)();
export const newToken = () => customAlphabet(lower, 18)();
export const newJoinCode = () => customAlphabet(upper, 6)();
export const newClaimCode = () => customAlphabet(upper, 8)();

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
}

export function uniqueSlug(input: string): string {
  return `${slugify(input) || "golf-day"}-${customAlphabet(lower, 5)()}`;
}
