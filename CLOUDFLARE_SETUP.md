# Cloudflare Setup Guide for Beginners

This guide walks you through setting up a Cloudflare account and deploying the Orange Telehealth application. It's designed for developers who are new to Cloudflare's platform.

## Table of Contents
1. [What is Cloudflare?](#what-is-cloudflare)
2. [Prerequisites](#prerequisites)
3. [Creating a Cloudflare Account](#creating-a-cloudflare-account)
4. [Setting up Cloudflare Calls](#setting-up-cloudflare-calls)
5. [Installing Wrangler CLI](#installing-wrangler-cli)
6. [Configuring Your Project](#configuring-your-project)
7. [Local Development](#local-development)
8. [Deploying to Production](#deploying-to-production)
9. [Understanding Cloudflare Services](#understanding-cloudflare-services)
10. [Troubleshooting](#troubleshooting)

## What is Cloudflare?

Cloudflare is a global cloud platform that provides:
- **Content Delivery Network (CDN)**: Fast content delivery worldwide
- **Edge Computing**: Run code close to users (Cloudflare Workers)
- **WebRTC Infrastructure**: Managed real-time communication (Cloudflare Calls)
- **Serverless Functions**: Code that runs without managing servers

### Why Cloudflare for Telehealth?

- **Global reach**: Low latency for users anywhere in the world
- **Built-in WebRTC**: No need to manage TURN/STUN servers
- **Scalability**: Automatically handles traffic spikes
- **Cost-effective**: Pay only for what you use

## Prerequisites

Before starting, make sure you have:
- **Node.js** version 16.13 or higher ([download](https://nodejs.org/))
- **npm** (comes with Node.js)
- **A text editor** (VS Code, Sublime Text, etc.)
- **A web browser** (Chrome, Firefox, Edge)
- **Basic terminal/command line knowledge**

Check your Node.js version:
```bash
node --version
# Should output v16.13.0 or higher
```

## Creating a Cloudflare Account

### Step 1: Sign Up

1. Visit [cloudflare.com](https://cloudflare.com)
2. Click "Sign Up" in the top right
3. Enter your email and create a password
4. Verify your email address

### Step 2: Choose a Plan

For development and testing:
- **Free plan** is sufficient to get started
- Includes Cloudflare Calls with generous limits
- No credit card required initially

For production telehealth applications:
- Consider the **Workers Paid plan** ($5/month)
- Provides higher limits and better support
- Required for serious production use

## Setting up Cloudflare Calls

Cloudflare Calls is the WebRTC infrastructure that powers the video/audio communication.

### Step 1: Navigate to Calls Dashboard

1. Log into [dash.cloudflare.com](https://dash.cloudflare.com)
2. From the left sidebar, select your account
3. Click on **"Calls"** in the sidebar
   - If you don't see it, search for "Calls" in the search bar

### Step 2: Create a Calls Application

1. Click **"Create Application"**
2. Choose a name (e.g., "Orange Telehealth Dev")
3. Click **"Create"**

### Step 3: Save Your Credentials

After creating the application, you'll see:

- **App ID**: A unique identifier (looks like `abc123def456...`)
- **App Secret**: A secret token (like a password)

**IMPORTANT**: Copy both values immediately!
- The secret is only shown once
- Store them securely (password manager, `.env` file)
- Never commit secrets to git

Example (these are fake):
```
App ID: abc123def456ghi789jkl012mno345pqr678
App Secret: secret-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz
```

## Installing Wrangler CLI

Wrangler is Cloudflare's command-line tool for managing Workers and deployments.

### Install Wrangler Globally

```bash
npm install -g wrangler
```

Verify installation:
```bash
wrangler --version
# Should output version 3.x.x or higher
```

### Authenticate Wrangler

```bash
wrangler login
```

This will:
1. Open your browser
2. Ask you to log into Cloudflare
3. Grant Wrangler access to your account
4. Redirect back to the terminal

You should see: "Successfully logged in"

## Configuring Your Project

### Step 1: Clone/Download the Project

If you haven't already:
```bash
git clone <repository-url>
cd orange
```

### Step 2: Install Dependencies

```bash
npm install
```

This downloads all required packages (may take a few minutes).

### Step 3: Create `.dev.vars` File

This file stores secrets for local development.

Create a file named `.dev.vars` in the project root:
```bash
touch .dev.vars
```

Add your Cloudflare Calls credentials (**replace these with your actual values**):
```
CALLS_APP_ID=YOUR_ACTUAL_APP_ID_HERE
CALLS_APP_SECRET=YOUR_ACTUAL_APP_SECRET_HERE
```

**Example** (these are fake credentials - use your own):
```
CALLS_APP_ID=abc123def456ghi789jkl012mno345pqr678
CALLS_APP_SECRET=secret-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz
```

**IMPORTANT**: Never commit `.dev.vars` to git!
- It's already in `.gitignore`
- Contains sensitive secrets

### Step 4: Update `wrangler.toml`

**IMPORTANT**: Open `wrangler.toml` and replace the placeholder `YOUR_CALLS_APP_ID_HERE` with your actual App ID:

```toml
[vars]
CALLS_APP_ID = "abc123def456ghi789jkl012mno345pqr678"  # Replace YOUR_CALLS_APP_ID_HERE with your actual App ID
```

If deploying to production environments (using environment-specific wrangler files), also replace:
- `YOUR_ACCOUNT_ID_HERE` with your Cloudflare Account ID (found in your dashboard URL)
- `YOUR_TURN_SERVICE_ID_HERE` with your TURN Service ID (if using TURN)

**Note**: Only put the App ID here, not the secret!
- App ID: Can be public (in `wrangler.toml`)
- App Secret: Must be private (in `.dev.vars` or as a secret)

## Local Development

### Start the Development Server

```bash
npm run dev
```

You should see output like:
```
⎔ Starting local server...
Ready on http://127.0.0.1:8787
```

### Test the Application

1. Open your browser to [http://127.0.0.1:8787](http://127.0.0.1:8787)
2. Enter a username and room name
3. Grant camera/microphone permissions when prompted
4. You should see the meeting interface

### Test Hospital Station

1. Visit `http://127.0.0.1:8787/test-room/hospital`
2. Grant permissions for multiple cameras if available
3. Click the camera buttons to add/remove cameras
4. You should see local camera previews

### Test Technician Station

1. In a new browser tab/window, visit `http://127.0.0.1:8787/test-room/technician`
2. You should see the hospital's camera feeds appear as separate tiles

### Common Development Issues

**"Failed to fetch Calls credentials"**
- Check that `.dev.vars` exists and contains correct credentials
- Verify App ID and Secret are copied correctly (no extra spaces)

**"Cannot access camera"**
- Grant browser permissions for camera/microphone
- Check that another app isn't using the camera
- Try a different browser

**"Module not found" errors**
- Run `npm install` again
- Delete `node_modules` and run `npm install` fresh

## Deploying to Production

### Step 1: Set Production Secret

The App Secret cannot be in `wrangler.toml` (it's a secret!). Set it as a Cloudflare secret:

```bash
wrangler secret put CALLS_APP_SECRET
```

You'll be prompted to enter the secret. Paste your App Secret and press Enter.

### Step 2: Update Production Config

Verify `wrangler.toml` has your actual production App ID (not the placeholder):
```toml
[vars]
CALLS_APP_ID = "abc123def456ghi789jkl012mno345pqr678"  # Must be your actual App ID, not YOUR_CALLS_APP_ID_HERE
```

### Step 3: Deploy

```bash
npm run deploy
```

This will:
1. Run tests to verify code quality
2. Build the application
3. Upload to Cloudflare's edge network
4. Return a deployment URL

Example output:
```
Uploaded orange-meets (2.34 sec)
Published orange-meets
  https://orange-meets.your-subdomain.workers.dev
```

### Step 4: Test Production Deployment

Visit the deployed URL in your browser:
```
https://orange-meets.your-subdomain.workers.dev
```

Test the hospital and technician interfaces:
```
https://orange-meets.your-subdomain.workers.dev/test-room/hospital
https://orange-meets.your-subdomain.workers.dev/test-room/technician
```

### Custom Domain (Optional)

To use your own domain (e.g., `telehealth.yourdomain.com`):

1. Add your domain to Cloudflare (if not already)
2. Go to Workers & Pages > Your Worker > Settings > Domains
3. Click "Add Custom Domain"
4. Enter your desired subdomain
5. Cloudflare will configure DNS automatically

## Understanding Cloudflare Services

### Cloudflare Workers

**What**: Serverless JavaScript that runs on Cloudflare's edge network
**How**: Your app code runs in 200+ data centers worldwide
**Cost**: First 100,000 requests/day are free

In this app:
- Remix SSR (Server-Side Rendering) runs on Workers
- API routes run on Workers
- Durable Objects coordinate WebSocket connections

### Cloudflare Calls

**What**: Managed WebRTC infrastructure (STUN, TURN, SFU)
**How**: Handles media relay without you managing servers
**Cost**: First 1,000 participant-minutes/month free

In this app:
- Video tracks are pushed/pulled via Calls
- Calls acts as an SFU (Selective Forwarding Unit)
- Handles NAT traversal automatically

### Durable Objects

**What**: Stateful coordination for real-time applications
**How**: Single instance per room, guarantees consistency
**Cost**: Included with Workers Paid plan

In this app:
- ChatRoom Durable Object manages room state
- Handles WebSocket connections for signaling
- Coordinates user list and track metadata

### PartyKit (via partyserver)

**What**: Open-source library for building real-time apps
**How**: Simplifies Durable Objects and WebSocket management
**Cost**: Free (open source)

In this app:
- `partyserver` provides WebSocket server framework
- `partytracks` integrates WebRTC with Cloudflare Calls
- Handles Observable-based track management

## Troubleshooting

### Cannot Deploy: "Authentication Error"

**Solution**: Re-authenticate Wrangler
```bash
wrangler logout
wrangler login
```

### Video Not Working in Production

**Check**:
1. Browser permissions for camera/microphone
2. HTTPS is being used (WebRTC requires it)
3. Firewall isn't blocking WebRTC ports
4. Try with TURN service (see Optional TURN Setup)

### High Latency/Poor Quality

**Solutions**:
- Enable TURN service (see Optional TURN Setup)
- Check user's internet connection
- Reduce video bitrate in code (adjust `maxBitrate`)
- Enable simulcast for adaptive quality

### Optional TURN Setup

TURN helps connectivity in restrictive networks (corporate firewalls, etc.).

1. Go to Cloudflare Dashboard > Calls
2. Enable TURN service
3. Copy the TURN Service ID and Token
4. Replace the placeholder in `wrangler.toml`:
```toml
[vars]
TURN_SERVICE_ID = "your-actual-turn-service-id"  # Replace YOUR_TURN_SERVICE_ID_HERE with this
```
5. Set the token as a secret:
```bash
wrangler secret put TURN_SERVICE_TOKEN
```

### Getting Help

- **Cloudflare Discord**: [discord.gg/cloudflare](https://discord.gg/cloudflare)
- **Cloudflare Docs**: [developers.cloudflare.com](https://developers.cloudflare.com)
- **Cloudflare Calls Docs**: [developers.cloudflare.com/calls](https://developers.cloudflare.com/calls/)
- **GitHub Issues**: Check the project's issue tracker

## Cost Estimation

### Free Tier (Development/Testing)
- **Workers**: 100,000 requests/day
- **Calls**: 1,000 participant-minutes/month
- **Durable Objects**: Not included (need paid plan)

**Suitable for**: Local development, small demos

### Paid Plan (Production)
- **Workers Paid**: $5/month + usage
  - 10 million requests/month included
  - $0.50 per million additional requests
- **Calls**: First 1,000 participant-minutes free
  - $0.05 per participant-minute after
- **Durable Objects**: Included with Workers Paid
  - $0.15 per million requests

**Example calculation for small clinic**:
- 20 sessions/day × 30 minutes each = 600 minutes/day
- 18,000 minutes/month
- Cost: $5 (Workers) + $850 (Calls) = $855/month

**Note**: This is for demonstration purposes. Production telehealth has additional compliance requirements (HIPAA, etc.) which may require Cloudflare Enterprise.

## Next Steps

Once you have the app running:

1. **Customize for your use case**
   - Modify camera quality settings
   - Adjust UI for your branding
   - Add authentication

2. **Add security**
   - Implement user authentication
   - Add room access controls
   - Consider end-to-end encryption

3. **Monitor performance**
   - Set up Cloudflare Analytics
   - Monitor Calls usage
   - Track error rates

4. **Compliance** (if medical use)
   - Consult HIPAA compliance requirements
   - Consider Cloudflare Enterprise
   - Implement audit logging

## Additional Resources

### Cloudflare Learning
- [Cloudflare Workers Tutorials](https://developers.cloudflare.com/workers/tutorials/)
- [Cloudflare Calls Quickstart](https://developers.cloudflare.com/calls/get-started/)
- [Durable Objects Guide](https://developers.cloudflare.com/workers/learning/using-durable-objects/)

### WebRTC Learning
- [WebRTC Basics](https://webrtc.org/getting-started/overview)
- [MDN WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)

### Project Documentation
- [README.md](./README.md) - Project overview
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Detailed system architecture

## Conclusion

You now have Orange Telehealth running on Cloudflare's infrastructure!

The platform provides:
- Global low-latency video delivery
- Automatic scaling
- Managed WebRTC infrastructure
- Simplified deployment

Remember: This is a demonstration application. Production telehealth systems require additional security, compliance, and reliability features.

For production use, consult with:
- Healthcare compliance experts (HIPAA, etc.)
- Security professionals
- Cloudflare Enterprise sales team
