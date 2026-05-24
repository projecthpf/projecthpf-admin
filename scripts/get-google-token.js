// One-time script to get a Google OAuth refresh token.
//
// Usage:
//   1. Add your OAuth credentials to .env.local:
//        GOOGLE_CLIENT_ID=...apps.googleusercontent.com
//        GOOGLE_CLIENT_SECRET=GOCSPX-...
//   2. Run:    node scripts/get-google-token.js
//   3. Follow the printed URL, sign in, paste the printed refresh
//      token back into .env.local as GOOGLE_REFRESH_TOKEN.
//
// SECURITY: never hard-code credentials in this file. Anything pasted
// here will be visible forever in git history and may be flagged by
// GitHub's secret scanner (and rightly so).

require('dotenv').config({ path: '.env.local' })
const http = require('http')
const { google } = require('googleapis')

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REDIRECT_URI  = 'http://localhost:3333/callback'

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env.local\n')
  process.exit(1)
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)

const SCOPES = ['https://www.googleapis.com/auth/calendar']

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
})

console.log('\n========================================')
console.log('Google Calendar Authorization')
console.log('========================================\n')
console.log('1. Open this URL in your browser:\n')
console.log(authUrl)
console.log('\n2. Sign in with the Google account that owns the calendar')
console.log('3. Grant access when prompted\n')

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/callback')) {
    const url = new URL(req.url, 'http://localhost:3333')
    const code = url.searchParams.get('code')

    if (code) {
      try {
        const { tokens } = await oauth2Client.getToken(code)
        console.log('\n✅ SUCCESS! Here is your refresh token:\n')
        console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token)
        console.log('\nPaste this into your .env.local file.\n')

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>✅ Success!</h1><p>Refresh token has been printed in your terminal.</p><p>You can close this tab.</p></body></html>')
      } catch (err) {
        console.error('Error getting token:', err.message)
        res.writeHead(500, { 'Content-Type': 'text/html' })
        res.end('<html><body><h1>Error</h1><p>' + err.message + '</p></body></html>')
      }
    }

    setTimeout(() => { server.close(); process.exit(0) }, 1000)
  }
})

server.listen(3333, () => {
  console.log('Waiting for authorization callback on http://localhost:3333 ...\n')
})
