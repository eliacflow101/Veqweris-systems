import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/auth")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const isAuth = request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup" || request.nextUrl.pathname.startsWith("/auth");
  const hasSession = Boolean(request.cookies.get("__session")?.value);
  if (!isAuth && !hasSession) return NextResponse.redirect(new URL("/login", request.url));
  if (isAuth && hasSession) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|branding).*)"] };
