import { mobileMethodNotAllowed } from "@/lib/mobile-api";

export { mobileLogout as POST } from "@/lib/mobile-api";
export function GET() { return mobileMethodNotAllowed("POST"); }
export const HEAD = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
