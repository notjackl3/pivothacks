import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const OTP_TYPES: ReadonlySet<string> = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/** Only same-origin paths are honoured as a post-login destination. */
function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/setup";
  return raw;
}

/**
 * Magic-link landing. Supabase sends the browser here with either `?code=` (PKCE) or
 * `?token_hash=&type=` (OTP hash); both end in a session cookie and a redirect to /setup.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const params = req.nextUrl.searchParams;
  const origin = req.nextUrl.origin;
  const next = safeNextPath(params.get("next"));

  const loginWithError = (message: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`, { status: 302 });

  // Supabase forwards its own failures (expired or already-used link) as error params.
  const upstreamError = params.get("error_description") ?? params.get("error");
  if (upstreamError) return loginWithError(upstreamError);

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    return loginWithError(err instanceof Error ? err.message : "Supabase is not configured");
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return loginWithError(error.message);
    return NextResponse.redirect(`${origin}${next}`, { status: 302 });
  }

  if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    if (error) return loginWithError(error.message);
    return NextResponse.redirect(`${origin}${next}`, { status: 302 });
  }

  return loginWithError("The sign-in link is missing its code. Request a new one.");
}
