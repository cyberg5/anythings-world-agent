/**
 * One-time TikTok authorization: `npm run build && npm run auth:tiktok`.
 *
 * Needs TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET and TIKTOK_REDIRECT_URI in
 * .env. TikTok only accepts an HTTPS redirect URI that is registered in your
 * TikTok developer app (no http://localhost like Google) — it does NOT need
 * to be a working page: after you approve, just copy the FULL address from
 * the browser's address bar (it contains ?code=...) and paste it here.
 * docs/oauth-callback.html is a ready-made page for GitHub Pages that shows
 * the code nicely, if you enable Pages on the repo.
 *
 * Prints TIKTOK_REFRESH_TOKEN — put it in the GitHub secret of that name.
 * (TikTok is filtered in Iran: run this with a VPN on.)
 */
import "dotenv/config";
import { randomBytes } from "crypto";
import readline from "readline/promises";

const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
const redirectUri = process.env.TIKTOK_REDIRECT_URI?.trim();
// video.publish only matters for TIKTOK_POST_MODE=direct; drop it if your app wasn't granted it.
const scopes = process.env.TIKTOK_SCOPES?.trim() || "user.info.basic,video.upload,video.publish";

async function main() {
  if (!clientKey || !clientSecret || !redirectUri) {
    throw new Error("Set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET and TIKTOK_REDIRECT_URI in .env first.");
  }
  const state = randomBytes(8).toString("hex");
  const authUrl =
    "https://www.tiktok.com/v2/auth/authorize/?" +
    new URLSearchParams({ client_key: clientKey, scope: scopes, response_type: "code", redirect_uri: redirectUri, state });

  console.log("\n1) Open this link (VPN on), log in with the TikTok account that should post, and approve:\n");
  console.log(authUrl);
  console.log("\n2) You'll land on your redirect page. Copy the FULL address from the address bar.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const pasted = (await rl.question("Paste the full address (or just the code) here: ")).trim();
  rl.close();

  let code = pasted;
  if (pasted.includes("code=")) {
    const params = new URL(pasted).searchParams;
    if (params.get("state") && params.get("state") !== state) throw new Error("State mismatch — start again.");
    code = params.get("code") ?? "";
  }
  if (!code) throw new Error("No authorization code found in what you pasted.");

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const json: any = await res.json();
  if (!json.refresh_token) throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);

  console.log(`\nGranted scopes: ${json.scope}`);
  console.log("\nAdd this as the GitHub secret TIKTOK_REFRESH_TOKEN (valid 180 days; the pipeline keeps it fresh):\n");
  console.log(json.refresh_token);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
