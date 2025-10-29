# Orange Telehealth - Architecture Documentation

This document provides a detailed explanation of how the Orange Telehealth application works, with a focus on video track management and data flow across participants.

## Table of Contents
1. [System Overview](#system-overview)
2. [Video Track Lifecycle](#video-track-lifecycle)
3. [Hospital Station Architecture](#hospital-station-architecture)
4. [Technician Station Architecture](#technician-station-architecture)
5. [Data Flow Diagrams](#data-flow-diagrams)
6. [WebSocket Signaling Protocol](#websocket-signaling-protocol)
7. [Key Technologies](#key-technologies)

## System Overview

### High-Level Architecture

```
┌─────────────────────┐
│  Hospital Station   │
│  (Multiple Cameras) │
└──────────┬──────────┘
           │
           │ Video Tracks (via PartyTracks/Cloudflare Calls)
           │ User State (via WebSocket)
           │
           ▼
┌─────────────────────────────────────┐
│   Cloudflare Edge Infrastructure    │
│                                     │
│  ┌──────────────────────────────┐  │
│  │   Durable Object (ChatRoom)  │  │
│  │   - WebSocket Signaling      │  │
│  │   - Room State Management    │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │   Cloudflare Calls           │  │
│  │   - WebRTC Infrastructure    │  │
│  │   - Media Relay (SFU)        │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
           │
           │ Video Tracks (via PartyTracks)
           │ User State (via WebSocket)
           │
           ▼
┌─────────────────────┐
│ Technician Station  │
│  (Multi-feed View)  │
└─────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|----------------|----------|
| **Remix Routes** | UI rendering and user interaction | Client browser |
| **React Hooks** | State management and side effects | Client browser |
| **PartyTracks** | WebRTC track publishing/subscribing | Client browser |
| **WebSocket (PartyServer)** | Signaling and user state sync | Durable Object |
| **Cloudflare Calls** | WebRTC media relay (SFU mode) | Cloudflare Edge |

## Video Track Lifecycle

Understanding the complete lifecycle of a video track is crucial for implementing similar systems.

### Phase 1: Capture (Client-Side)

**Location**: Browser on Hospital Station

1. User grants camera permissions
2. `navigator.mediaDevices.getUserMedia()` is called
3. Browser returns a `MediaStream` containing a `MediaStreamTrack`

```typescript
// Simplified example from useMultiCamera.ts
const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    deviceId: { exact: deviceId },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
})
const videoTrack = stream.getVideoTracks()[0]
```

### Phase 2: Reactive Wrapping (Client-Side)

**Location**: `useMultiCamera` hook

The raw MediaStreamTrack is wrapped in an RxJS BehaviorSubject to enable reactive programming:

```typescript
const track$ = new BehaviorSubject<MediaStreamTrack | null>(videoTrack)
```

**Why BehaviorSubject?**
- Emits current value to new subscribers immediately
- Allows track to be enabled/disabled reactively
- Integrates seamlessly with PartyTracks library

### Phase 3: Push to Cloudflare Calls (Client-Side)

**Location**: Hospital Station component

```typescript
const pushed$ = partyTracks.push(camera.track$ as Observable<MediaStreamTrack>, {
  sendEncodings$: of([
    {
      maxFramerate: 24,
      maxBitrate: 1_200_000,
    },
  ]),
})
```

**What happens during push:**
1. PartyTracks creates a WebRTC RTCPeerConnection
2. Track is added to the peer connection via `addTrack()`
3. SDP (Session Description Protocol) negotiation occurs
4. Track is sent to Cloudflare Calls infrastructure
5. PartyTracks assigns a unique `trackName` and `sessionId`

### Phase 4: Signal Track Availability (Client-Side → Server)

**Location**: Hospital Station component

```typescript
const message = JSON.stringify({
  type: 'userUpdate',
  user: {
    id: userId,
    name: userName,
    role: 'hospital',
    tracks: {
      cameras: [
        {
          deviceId: 'camera-1',
          trackName: 'abc123def/video-track-1', // sessionId/trackName format
          enabled: true,
        },
      ],
    },
  },
})
websocket.send(message)
```

**Key Point**: Only the track *identifier* is sent via WebSocket, not the actual video data. The video data flows through Cloudflare Calls infrastructure.

### Phase 5: Broadcast State to Other Participants (Server → Client)

**Location**: Durable Object (ChatRoom.server.ts)

The server receives the user update and broadcasts the room state to all connected participants:

```typescript
// Simplified server-side logic
function handleUserUpdate(user: User) {
  roomState.users = updateUserInList(roomState.users, user)
  broadcastToAll({
    type: 'roomState',
    state: roomState,
  })
}
```

### Phase 6: Pull Track (Client-Side)

**Location**: Technician Station

When the technician receives the room state update, they see the camera track identifiers:

```typescript
// From usePulledVideoTrack hook
const [sessionId, trackName] = video?.split('/') ?? []

const pulledTrack$ = partyTracks.pull(
  of({
    trackName,
    sessionId,
    location: 'remote',
  })
)
```

**What happens during pull:**
1. PartyTracks subscribes to the specified track from Cloudflare Calls
2. WebRTC negotiation occurs (if needed)
3. Media packets begin flowing from hospital to technician
4. A `MediaStreamTrack` object is returned to the client

### Phase 7: Render (Client-Side)

**Location**: VideoSrcObject component

```typescript
// Simplified rendering
<video
  ref={(el) => {
    if (el && pulledTrack) {
      el.srcObject = new MediaStream([pulledTrack])
    }
  }}
  autoPlay
  playsInline
/>
```

## Hospital Station Architecture

### Multi-Camera Management

The hospital station manages multiple simultaneous camera feeds using the `useMultiCamera` hook.

#### Data Structure

```typescript
interface CameraStream {
  deviceId: string              // Unique hardware device ID
  label: string                 // Human-readable name (e.g., "HD Webcam")
  stream: MediaStream           // Raw browser MediaStream
  track$: BehaviorSubject<MediaStreamTrack | null>  // Reactive track wrapper
  enabled: boolean              // Current enabled state
}
```

#### Camera State Management

```
Available Devices (from browser)
        │
        ▼
[Camera 1] [Camera 2] [Camera 3]
        │
        │ User clicks "Add Camera"
        ▼
   getUserMedia()
        │
        ▼
  MediaStream created
        │
        ▼
 Wrapped in BehaviorSubject
        │
        ▼
  Added to cameras Map
        │
        ▼
 Pushed to PartyTracks
        │
        ▼
Track metadata stored in state
        │
        ▼
Broadcast via WebSocket
```

#### Hospital User Object Structure

```typescript
{
  id: "user-123",
  name: "Hospital Station A",
  role: "hospital",
  tracks: {
    audio: "session-abc/audio-1",
    audioEnabled: true,
    cameras: [
      {
        deviceId: "camera-device-id-1",
        trackName: "session-abc/video-1",  // Full track identifier
        enabled: true
      },
      {
        deviceId: "camera-device-id-2",
        trackName: "session-abc/video-2",
        enabled: true
      }
    ],
    screenshare: "session-abc/screen-1",
    screenShareEnabled: false
  }
}
```

## Technician Station Architecture

### Multi-Feed Viewing

The technician station consumes multiple video feeds and displays them in a grid layout.

#### Feed Transformation

Hospital users with multiple cameras are "exploded" into separate virtual users for layout purposes:

```typescript
// From technician station
const hospitalFeeds = hospitalUsers.flatMap((user) => {
  const feeds = []

  // Each camera becomes a separate tile
  user.tracks.cameras?.forEach((camera, index) => {
    if (camera.trackName && camera.enabled) {
      feeds.push({
        ...user,
        id: `${user.id}-camera-${camera.deviceId}`,
        name: `${user.name} - Camera ${index + 1}`,
        tracks: {
          ...user.tracks,
          video: camera.trackName,  // Point to this specific camera
          cameras: undefined,        // Remove cameras array
        },
      })
    }
  })

  // Screenshare becomes a separate tile
  if (user.tracks.screenshare) {
    feeds.push({
      ...user,
      id: `${user.id}-screenshare`,
      name: `${user.name} - Screen`,
      tracks: {
        ...user.tracks,
        video: user.tracks.screenshare,
        cameras: undefined,
      },
    })
  }

  return feeds
})
```

#### Track Pulling Flow

```
WebSocket Message Received
        │
        ▼
Room State Updated
        │
        ▼
Hospital User with Cameras Array
        │
        ▼
Transform to Virtual Feeds
        │
        ▼
For Each Feed:
  Extract sessionId/trackName
        │
        ▼
  usePulledVideoTrack(trackName)
        │
        ▼
  partyTracks.pull({ sessionId, trackName })
        │
        ▼
  WebRTC Subscribes to Track
        │
        ▼
  MediaStreamTrack Received
        │
        ▼
  Render in <video> Element
```

## Data Flow Diagrams

### Complete Multi-Camera Session Flow

```
Hospital Station                    Durable Object              Technician Station
      │                                   │                             │
      │  1. getUserMedia() × 3            │                             │
      │     (3 cameras)                   │                             │
      │──────────────────────────────────▶│                             │
      │                                   │                             │
      │  2. partyTracks.push() × 3        │                             │
      │     Create 3 WebRTC tracks        │                             │
      │                                   │                             │
      │  3. WebSocket: userUpdate         │                             │
      │     {                             │                             │
      │       cameras: [                  │                             │
      │         {trackName: "s1/v1"},     │                             │
      │         {trackName: "s1/v2"},     │                             │
      │         {trackName: "s1/v3"}      │                             │
      │       ]                           │                             │
      │     }                             │                             │
      │──────────────────────────────────▶│                             │
      │                                   │                             │
      │                                   │  4. Broadcast roomState     │
      │                                   │─────────────────────────────▶│
      │                                   │                             │
      │                                   │  5. partyTracks.pull() × 3  │
      │                                   │    Subscribe to tracks      │
      │                                   │◀─────────────────────────────│
      │                                   │                             │
      │  6. Media flows through Cloudflare Calls (not through Durable Object)
      │══════════════════════════════════════════════════════════════════▶│
      │     Video data: Camera 1                                        │
      │══════════════════════════════════════════════════════════════════▶│
      │     Video data: Camera 2                                        │
      │══════════════════════════════════════════════════════════════════▶│
      │     Video data: Camera 3                                        │
      │                                   │                             │
      │                                   │     7. Render 3 video tiles │
      │                                   │                         ┌───┐
      │                                   │                         │ 1 │
      │                                   │                         ├───┤
      │                                   │                         │ 2 │
      │                                   │                         ├───┤
      │                                   │                         │ 3 │
      │                                   │                         └───┘
```

### Track Identifier Format

Track identifiers always follow the format: `sessionId/trackName`

```
Example: "abc123def456/video-camera-1"
         └─────┬─────┘  └──────┬──────┘
          sessionId      trackName
```

- **sessionId**: Identifies the WebRTC peer connection session (from PartyTracks)
- **trackName**: Unique name for the specific media track within that session

## WebSocket Signaling Protocol

### Message Types

#### Client → Server

1. **userUpdate**: Broadcast user state including track information
```typescript
{
  type: 'userUpdate',
  user: {
    id: string,
    name: string,
    role: 'hospital' | 'technician' | 'regular',
    tracks: {
      audio?: string,
      audioEnabled?: boolean,
      video?: string,
      videoEnabled?: boolean,
      cameras?: Array<{
        deviceId: string,
        trackName?: string,
        enabled: boolean
      }>,
      screenshare?: string,
      screenShareEnabled?: boolean
    }
  }
}
```

2. **heartbeat**: Keep connection alive
```typescript
{
  type: 'heartbeat'
}
```

#### Server → Client

1. **roomState**: Complete room state with all users
```typescript
{
  type: 'roomState',
  state: {
    meetingId: string,
    users: User[],
    ai: { enabled: boolean }
  }
}
```

### Important Signaling Principles

1. **Separation of Concerns**:
   - WebSocket carries *metadata* (who has what tracks)
   - Cloudflare Calls carries *media* (actual video/audio data)

2. **Track Identity**:
   - Tracks are identified by strings (`sessionId/trackName`)
   - These identifiers are shared via WebSocket
   - PartyTracks handles the actual WebRTC subscription

3. **State Synchronization**:
   - Each participant maintains their own track state
   - State is broadcast on changes
   - Server doesn't validate or transform track data

## Key Technologies

### PartyTracks

PartyTracks is a library that simplifies WebRTC track management with Cloudflare Calls.

**Key Features:**
- Observable-based API using RxJS
- Automatic peer connection management
- Track publishing (`push`) and subscribing (`pull`)
- Simulcast support for bandwidth optimization

**Example Usage:**
```typescript
// Publishing a track
const pushed$ = partyTracks.push(track$, { sendEncodings$ })

// Subscribing to a track
const pulled$ = partyTracks.pull(of({ sessionId, trackName, location: 'remote' }))
```

### RxJS Observables

The application uses RxJS extensively for reactive state management.

**Why Observables?**
- Tracks can change state (enabled/disabled)
- Users can join/leave dynamically
- Media quality can adjust in real-time
- Observables handle these changes elegantly

**Key Observable Patterns:**
```typescript
// BehaviorSubject - holds current value, emits to new subscribers
const track$ = new BehaviorSubject<MediaStreamTrack | null>(track)

// switchMap - switch to new observable when input changes
trackObject$.pipe(
  switchMap((track) =>
    track ? partyTracks.pull(of(track)) : of(undefined)
  )
)
```

### Cloudflare Calls (SFU Architecture)

Cloudflare Calls uses a Selective Forwarding Unit (SFU) architecture:

```
Hospital                    Cloudflare Calls                 Technician
   │                              │                              │
   │  Upload once                 │                              │
   │─────────────────────────────▶│                              │
   │                              │                              │
   │                              │  Forward to each subscriber  │
   │                              │─────────────────────────────▶│
   │                              │                              │
```

**Benefits:**
- Hospital uploads each track only once
- Cloudflare forwards tracks to all technicians
- Lower bandwidth usage for publisher
- Scalable to many viewers

**Alternative Architectures:**
- **Mesh**: Everyone connects to everyone (doesn't scale)
- **MCU**: Server mixes streams (high CPU cost)

## Best Practices for Track Management

### 1. Always Clean Up Tracks

```typescript
useEffect(() => {
  return () => {
    cameras.forEach((camera) => {
      camera.stream.getTracks().forEach((track) => track.stop())
      camera.track$.complete()
    })
  }
}, [])
```

### 2. Use Unique, Stable Identifiers

```typescript
// Good: Use device ID as stable key
<div key={camera.deviceId}>

// Bad: Use array index (can change)
<div key={index}>
```

### 3. Handle Track State Reactively

```typescript
// Enable/disable tracks by updating the Observable
if (enabled) {
  camera.track$.next(camera.stream.getVideoTracks()[0])
} else {
  camera.track$.next(null)
}
```

### 4. Broadcast State on Every Change

```typescript
useEffect(() => {
  // Re-broadcast whenever any track state changes
  websocket.send(JSON.stringify({ type: 'userUpdate', user }))
}, [trackState1, trackState2, trackState3])
```

## Performance Considerations

### Bandwidth

Each camera stream consumes bandwidth:
- 720p @ 24fps: ~1.2 Mbps (as configured)
- 3 cameras: ~3.6 Mbps upload from hospital
- Each technician: ~3.6 Mbps download

### CPU Usage

- Encoding: Hospital browser encodes each camera separately
- Decoding: Technician browser decodes all incoming streams
- Layout: React rendering for grid layout

### Optimization Strategies

1. **Simulcast**: Enable multiple quality levels per track
2. **Adaptive Bitrate**: Adjust quality based on network conditions
3. **Virtual Background**: Process video before sending (CPU intensive)
4. **Grid Virtualization**: Only render visible tiles

## Troubleshooting Guide

### Tracks Not Appearing

1. Check browser permissions for camera access
2. Verify track is being pushed: `console.log(pushed$)`
3. Confirm track identifier in WebSocket messages
4. Verify remote user is pulling the correct track identifier

### Audio Echo

- Ensure proper audio routing (don't pull your own audio)
- Check that `PullAudioTracks` filters out local user

### Poor Video Quality

- Check network bandwidth
- Reduce `maxBitrate` in push config
- Enable simulcast for adaptive quality
- Verify Cloudflare Calls is using TURN when needed

## Further Reading

- [WebRTC Basics](https://webrtc.org/getting-started/overview)
- [Cloudflare Calls Documentation](https://developers.cloudflare.com/calls/)
- [PartyKit Documentation](https://docs.partykit.io/)
- [RxJS Documentation](https://rxjs.dev/)
