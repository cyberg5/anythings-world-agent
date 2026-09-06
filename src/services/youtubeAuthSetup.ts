/**
 * ONE-TIME SETUP SCRIPT — run this exactly once (`npm run auth:youtube`).
 *
 * Google requires the channel owner to personally grant upload permission —
 * this is a security boundary Google enforces, not something this project
 * can skip. After you approve it once, the resulting refresh token lets the
 * pipeline upload forever without you touching anything again.
 *
 * Usage:
 *   1. Fill YT_CLIENT_ID / YT_CLIENT_SECRET in .env (from Google Cloud Console).
 *   2. `npm run auth:youtube`
 *   3. Open the printed URL, log in as the AnyThings World™ channel owner, approve.
 *   4. Copy the refresh_token it prints into YT_REFRESH_TOKEN in .env.
 */
import "dotenv/config";
import { google } from "googleapis";
import * as http from "http";
import { URL } from "url";

const CLIENT_ID = process.env.YT_CLIENT_ID!;
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET!;
const REDIRECT_URI = "http://localhost:53682/oauth2callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set YT_CLIENT_ID and YT_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
});

console.log("\nOpen this URL, sign in as the channel owner, and approve access:\n");
console.log(authUrl, "\n");

const server = http.createServer(async (req, res) => {
  if (!req.url) return;
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  if (!code) return;

  const { tokens } = await oauth2Client.getToken(code);
  res.end("Done — you can close this tab and go back to the terminal.");
  server.close();

  console.log("\nAdd this line to your .env file:\n");
  console.log(`YT_REFRESH_TOKEN=${tokens.refresh_token}\n`);
});

server.listen(53682, () => console.log("Waiting for you to approve in the browser..."));
