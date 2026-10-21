import { mobileMethodNotAllowed } from "@/lib/mobile-api";

export { mobileSession as GET, mobileSessionHead as HEAD } from "@/lib/mobile-api";
export function POST() { return mobileMethodNotAllowed("GET, HEAD"); }
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
export const OPTIONS = POST;
