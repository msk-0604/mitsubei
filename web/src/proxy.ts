import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIES = ["mitubei.session_token", "__Secure-mitubei.session_token"];

/**
 * 未ログインの画面アクセスをログイン画面へ振り分ける（Cookie の有無だけの簡易判定）。
 * セッションの有効性・所属企業・権限の確認は、必ず Workers API 側で行う。
 */
export function proxy(request: NextRequest) {
  if (!SESSION_COOKIES.some((n) => request.cookies.has(n))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|login|terms|privacy|legal|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|.*\\.(?:png|svg|ico|webp|txt)$).*)",
  ],
};
