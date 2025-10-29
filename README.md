# Orange Telehealth - Remote Medical Equipment Management

Orange Telehealth is a WebRTC-based video conferencing application built with [Cloudflare Calls](https://developers.cloudflare.com/calls/) that demonstrates how to create a telehealth platform for remote technicians to manage medical scanning equipment (MRIs, CT scans, X-Rays, etc.) at hospital sites.

## Use Case: Remote Medical Equipment Support

This application showcases a real-world telehealth scenario where:
- **Hospital staff** set up multiple cameras at scanning equipment locations
- **Remote technicians** connect to view live feeds and provide support
- **Real-time communication** happens via audio/video between all participants

This sample application demonstrates key concepts for building similar telehealth solutions using Cloudflare's edge infrastructure.

## Key Features

- **Multi-camera support**: Hospital stations can broadcast multiple camera feeds simultaneously
- **Role-based interfaces**: Different UIs for hospital staff, technicians, and general participants
- **Real-time video tracks**: Efficient handling of multiple video streams using WebRTC
- **Edge computing**: Runs on Cloudflare Workers for global low-latency access
- **Built-in signaling**: Uses PartyKit for WebSocket-based signaling

For simpler Cloudflare Calls examples, visit [github.com/cloudflare/calls-examples](https://github.com/cloudflare/calls-examples).

![A screenshot showing a room in Orange Meets](orange-meets.png)

## Architecture Diagram

![Diagram of Orange Meets architecture](architecture.png)

## Application Roles

This application supports three distinct user roles, each with a specialized interface:

### 1. Hospital Station (`/room-name/hospital`)
The hospital interface is designed for on-site staff who need to broadcast video from multiple cameras:
- **Multi-camera management**: Add/remove cameras, enable/disable individual feeds
- **Local preview**: See all active camera feeds before they're sent to technicians
- **Audio communication**: Two-way audio with remote technicians
- **Screen sharing**: Share additional context from hospital systems

**Video Track Flow**: Each camera creates a separate video track that is:
1. Captured via `useMultiCamera` hook using WebRTC getUserMedia API
2. Wrapped in an RxJS BehaviorSubject for reactive state management
3. Pushed to Cloudflare Calls via PartyTracks library
4. Broadcast to all technician participants via WebSocket signaling

### 2. Technician Station (`/room-name/technician`)
The technician interface is designed for remote experts providing equipment support:
- **Multi-feed viewing**: See all hospital camera feeds in a grid layout
- **Automatic feed management**: Each camera and screen share appears as a separate tile
- **Audio communication**: Two-way audio with hospital staff
- **Own camera**: Technicians can share their own video feed if needed

**Video Track Flow**: Technician receives:
1. WebSocket messages containing track identifiers (`sessionId/trackName`)
2. Uses `usePulledVideoTrack` hook to subscribe to remote tracks via PartyTracks
3. Renders each track in a separate video element
4. Audio tracks are automatically pulled and mixed for playback

### 3. Regular Meeting Room (`/room-name/room`)
A standard video conferencing interface for general collaboration:
- **Standard video conferencing**: Camera, microphone, screen sharing
- **Stage management**: Active speaker detection and layout optimization
- **Participant controls**: Mute, raise hand, see participant list

## How Video Tracks Work in This Application

### Track Lifecycle
1. **Capture**: Video is captured from local devices using WebRTC's `getUserMedia` API
2. **Push**: Tracks are pushed to Cloudflare Calls using the `partyTracks.push()` method
3. **Signal**: Track metadata (sessionId/trackName) is broadcast via WebSocket to other participants
4. **Pull**: Remote participants use `partyTracks.pull()` to subscribe to specific tracks
5. **Render**: Pulled tracks are attached to HTML video elements for display

### Track Identification
Each video track is uniquely identified by a combination of:
- **sessionId**: Identifies the WebRTC peer connection session
- **trackName**: Unique name for the specific media track
- **Format**: Tracks are referenced as `"sessionId/trackName"` strings

### Multi-Camera Architecture
The hospital station can manage multiple cameras simultaneously:
- Each camera has its own `MediaStream` and `MediaStreamTrack`
- Each track is pushed independently to Cloudflare Calls
- Track metadata is stored in the User object's `tracks.cameras` array
- Technicians receive each camera as a separate video feed

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed diagrams and data flow explanations.

## Setup Instructions

### Prerequisites
- Node.js >= 16.13
- A Cloudflare account (free tier works)
- Basic understanding of WebRTC concepts (helpful but not required)

### Variables

Go to the [Cloudflare Calls dashboard](https://dash.cloudflare.com/?to=/:account/calls) and create an application.

Put these variables into `.dev.vars` (**replace the placeholders with your actual values**):

```
CALLS_APP_ID=YOUR_ACTUAL_APP_ID_HERE
CALLS_APP_SECRET=YOUR_ACTUAL_APP_SECRET_HERE
```

### Optional variables

The following variables are optional:

- `MAX_WEBCAM_BITRATE` (default `1200000`): the maximum bitrate for each meeting participant's webcam.
- `MAX_WEBCAM_FRAMERATE` (default: `24`): the maximum number of frames per second for each meeting participant's webcam.
- `MAX_WEBCAM_QUALITY_LEVEL` (default `1080`): the maximum resolution for each meeting participant's webcam, based on the smallest dimension (i.e. the default is 1080p).

To customise these variables, place replacement values in `.dev.vars` (for development) and in the `[vars]` section of `wrangler.toml` (for the deployment).

## Development

### Install dependencies
```sh
npm install
```

### Start the development server
```sh
npm run dev
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787) in your browser.

### Testing Different Roles

To test the telehealth scenario locally:

1. **Create a room**: Visit `http://127.0.0.1:8787/test-room` and enter a username
2. **Open hospital station**: In a new tab/window, visit `http://127.0.0.1:8787/test-room/hospital`
   - Grant camera permissions when prompted
   - You'll see a list of available cameras - click to add/remove them
   - Each active camera will show a preview
3. **Open technician station**: In another tab/window, visit `http://127.0.0.1:8787/test-room/technician`
   - You should see all the hospital's camera feeds appearing as separate tiles
   - Audio will be automatically mixed if the hospital has their mic enabled

**Pro tip**: Use different browser profiles or browsers to simulate different users with different cameras.

## Deployment

Deploy this application to Cloudflare Workers for production use.

### Step 1: Install and authenticate Wrangler CLI
```sh
wrangler login
```

### Step 2: Configure your Calls App ID and Account ID

**IMPORTANT**: Before deploying, you must replace the placeholder values in `wrangler.toml`:

1. Replace `YOUR_CALLS_APP_ID_HERE` with your actual Cloudflare Calls App ID from the [Calls Dashboard](https://dash.cloudflare.com/?to=/:account/calls)
2. Find your Account ID in the Cloudflare Dashboard URL (it's in the format `dash.cloudflare.com/[YOUR_ACCOUNT_ID]`) and update the `account_id` field if deploying to production environments

Example:
```toml
[vars]
CALLS_APP_ID = "abc123def456ghi789"  # Replace YOUR_CALLS_APP_ID_HERE with this
```

### Step 3: Set your Calls App Secret
```sh
wrangler secret put CALLS_APP_SECRET
```
Enter your secret when prompted, or pipe it programmatically:
```sh
echo "YOUR_SECRET_HERE" | wrangler secret put CALLS_APP_SECRET
```

### Step 4: (Optional) Enable TURN service
For better connectivity across restrictive networks, enable [Cloudflare's TURN Service](https://developers.cloudflare.com/calls/turn/):
- Replace `YOUR_TURN_SERVICE_ID_HERE` with your TURN Service ID in `wrangler.toml` (or add the `TURN_SERVICE_ID` variable if not present)
- Set the secret: `wrangler secret put TURN_SERVICE_TOKEN`

### Step 5: Deploy
```sh
npm run deploy
```

Your application will be deployed to Cloudflare's global network. The deployment command:
- Runs type checking and tests
- Builds the application with source maps
- Removes source maps for production
- Deploys to Cloudflare Workers

**Note**: For telehealth production use, ensure you comply with healthcare regulations (HIPAA, etc.). This sample application is for demonstration purposes only.

## Project Structure

```
app/
├── routes/                          # Remix routes
│   ├── _room.$roomName.hospital.tsx    # Hospital multi-camera interface
│   ├── _room.$roomName.technician.tsx  # Technician viewing interface
│   └── _room.$roomName.room.tsx        # Standard meeting room
├── hooks/                           # React hooks
│   ├── useMultiCamera.ts               # Multi-camera management
│   ├── useBroadcastStatus.ts           # User status broadcasting via WebSocket
│   ├── usePulledVideoTrack.tsx         # Remote video track consumption
│   └── usePeerConnection.tsx           # WebRTC peer connection management
├── components/                      # React components
│   ├── PullAudioTracks.tsx             # Audio track management
│   ├── ParticipantLayout.tsx           # Video grid layout
│   └── VideoSrcObject.tsx              # Video element with track binding
├── types/
│   └── Messages.ts                     # WebSocket message and user types
└── durableObjects/
    └── ChatRoom.server.ts              # WebSocket signaling server
```

## Learn More

### Cloudflare Technologies Used
- **[Cloudflare Calls](https://developers.cloudflare.com/calls/)**: Managed WebRTC infrastructure
- **[Cloudflare Workers](https://workers.cloudflare.com/)**: Serverless compute platform
- **[Durable Objects](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/)**: Stateful coordination for room state
- **[PartyKit](https://www.partykit.io/)**: WebSocket server framework (via partyserver)
- **[PartyTracks](https://github.com/partykit/partykit/tree/main/packages/partytracks)**: WebRTC track management library

### Key Concepts for Beginners
- **WebRTC**: Real-time communication protocol for audio/video
- **Signaling**: Process of coordinating WebRTC connections via WebSocket
- **Track**: Individual media stream (one video camera = one track)
- **Push/Pull**: Publishing (push) and subscribing (pull) to media tracks
- **Session ID**: Unique identifier for a WebRTC peer connection

## Additional Documentation
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Detailed system architecture and data flows
- [CLOUDFLARE_SETUP.md](./CLOUDFLARE_SETUP.md) - Step-by-step Cloudflare configuration guide

## Contributing
This is a demonstration application. Feel free to fork and adapt it for your own telehealth or multi-camera video conferencing needs.
