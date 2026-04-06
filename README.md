# LinkedIn MCP Server

Connect your LinkedIn account to Claude via the Model Context Protocol.

## Tools available

| Tool | Description |
|------|-------------|
| `linkedin_get_profile` | Get your profile (name, headline, email) |
| `linkedin_create_post` | Publish a post to LinkedIn |
| `linkedin_get_my_posts` | List your recent posts |
| `linkedin_search_jobs` | Search job listings |
| `linkedin_get_connections` | List your 1st-degree connections |
| `linkedin_search_people` | Search for LinkedIn members |
| `linkedin_auth_status` | Check if your account is connected |

---

## Setup

### 1. Create a LinkedIn Developer App

1. Go to https://www.linkedin.com/developers/apps and create a new app
2. Under **Auth**, add your redirect URI:
   - Local: `http://localhost:3000/auth/callback`
   - Railway: `https://your-app.up.railway.app/auth/callback`
3. Request these OAuth 2.0 scopes: `openid`, `profile`, `email`, `w_member_social`
4. Copy your **Client ID** and **Client Secret**

### 2. Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app)

1. Push this repo to GitHub
2. Create a new Railway project from your repo
3. Set these environment variables in Railway:

```
LINKEDIN_CLIENT_ID=your_client_id
LINKEDIN_CLIENT_SECRET=your_client_secret
BASE_URL=https://your-app.up.railway.app
SESSION_SECRET=<random 32-char string>
```

4. Railway will build and deploy automatically. Note your public URL.
5. Add the redirect URI in your LinkedIn app: `https://your-app.up.railway.app/auth/callback`

### 3. Authenticate with LinkedIn

Visit `https://your-app.up.railway.app/auth/login` in your browser and authorize the app.

### 4. Connect to Claude

In Claude settings → MCP Servers, add:

```
URL: https://your-app.up.railway.app/mcp/sse
```

---

## Local development

```bash
cp .env.example .env
# Fill in your credentials in .env

npm install
npm run dev
```

Then visit http://localhost:3000/auth/login to authenticate.

Add to Claude locally:
```
URL: http://localhost:3000/mcp/sse
```

---

## API scope notes

- **Profile & posting** (`openid`, `profile`, `email`, `w_member_social`) — available to all apps
- **Connections** (`r_1st_3rd_connections`) — requires LinkedIn Partner Program approval
- **Job search** (`r_jobs`) — requires LinkedIn Partner Program approval

If you hit permission errors on connections/jobs, those endpoints need elevated API access from LinkedIn.
