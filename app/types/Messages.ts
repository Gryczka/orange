/**
 * Message Type Definitions
 *
 * Defines TypeScript types for WebSocket messages and user state in the application.
 *
 * Key Concepts:
 * - WebSocket carries METADATA about tracks (identifiers), not actual media data
 * - Track identifiers follow format: "sessionId/trackName"
 * - User objects contain track identifiers that remote participants use to pull tracks
 * - The cameras array is specific to the hospital role for multi-camera support
 *
 * Data Flow:
 * 1. Client pushes track to Cloudflare Calls via partyTracks.push()
 * 2. Client receives track identifier (sessionId/trackName)
 * 3. Client sends User object with track identifier via WebSocket
 * 4. Server broadcasts User object to all participants
 * 5. Remote participants use track identifier with partyTracks.pull()
 */

import { type ApiHistoryEntry } from 'partytracks/client'
import type { TrackObject } from '~/utils/callsTypes'

/**
 * UserRole Type
 *
 * Defines the three roles in the telehealth system, each with different capabilities:
 *
 * - **regular**: Standard video conference participant (single camera, single audio track)
 * - **hospital**: On-site hospital staff with multi-camera support for equipment viewing
 * - **technician**: Remote expert viewing hospital feeds and providing support
 *
 * Roles determine:
 * - UI layout (hospital shows camera management, technician shows multi-feed grid)
 * - Track structure (hospital uses cameras array, others use single video track)
 * - Participant filtering (technicians only see hospitals, hospitals only see technicians)
 */
export type UserRole = 'regular' | 'hospital' | 'technician'

/**
 * User Type
 *
 * Represents a participant in the room and their media track state.
 * This object is broadcast via WebSocket to all participants.
 *
 * IMPORTANT: Track fields contain IDENTIFIERS (strings), not actual MediaStreamTracks.
 * Format: "sessionId/trackName"
 *
 * Example hospital user with 3 cameras:
 * ```typescript
 * {
 *   id: "user-123",
 *   name: "Hospital Station A",
 *   role: "hospital",
 *   tracks: {
 *     audio: "session-abc/audio-1",
 *     cameras: [
 *       { deviceId: "camera-1", trackName: "session-abc/video-1", enabled: true },
 *       { deviceId: "camera-2", trackName: "session-abc/video-2", enabled: true },
 *       { deviceId: "camera-3", trackName: "session-abc/video-3", enabled: true }
 *     ]
 *   }
 * }
 * ```
 *
 * Example technician user:
 * ```typescript
 * {
 *   id: "user-456",
 *   name: "Dr. Smith",
 *   role: "technician",
 *   tracks: {
 *     audio: "session-def/audio-1",
 *     video: "session-def/video-1",
 *     videoEnabled: true
 *   }
 * }
 * ```
 */
export type User = {
	/** Unique user identifier (generated client-side) */
	id: string

	/** Display name */
	name: string

	/** WebRTC session ID from PartyTracks - identifies the peer connection */
	transceiverSessionId?: string

	/** Whether user has their hand raised (regular meeting feature) */
	raisedHand: boolean

	/** Whether user is currently speaking (detected via audio level analysis) */
	speaking: boolean

	/** Whether user is still in the room (false when leaving) */
	joined: boolean

	/** User role - determines UI and track structure */
	role?: UserRole

	/**
	 * Track Identifiers
	 *
	 * Contains identifiers for all media tracks this user is publishing.
	 * Remote participants use these identifiers with partyTracks.pull() to subscribe.
	 *
	 * Track Identifier Format: "sessionId/trackName"
	 * Example: "abc123def456/video-camera-1"
	 */
	tracks: {
		/** Audio track identifier */
		audio?: string

		/** Whether audio track is enabled (not muted) */
		audioEnabled?: boolean

		/** Whether audio is unavailable (no microphone access) */
		audioUnavailable: boolean

		/** Video track identifier (single camera - used by regular and technician roles) */
		video?: string

		/** Whether video track is enabled */
		videoEnabled?: boolean

		/** Screen share track identifier */
		screenshare?: string

		/** Whether screen share is active */
		screenShareEnabled?: boolean

		/**
		 * Multiple Camera Tracks (Hospital Role Only)
		 *
		 * Hospital users can publish multiple simultaneous camera feeds.
		 * Each camera is represented by an object with:
		 * - deviceId: Hardware device identifier (stable across sessions)
		 * - trackName: Full track identifier "sessionId/trackName"
		 * - enabled: Current enabled state (can be disabled temporarily)
		 *
		 * Why separate from 'video' field?
		 * - Regular/technician participants have one video track (use 'video' field)
		 * - Hospital participants have multiple video tracks (use 'cameras' array)
		 * - This structure accommodates both patterns in a single type
		 *
		 * Consumption pattern (on technician side):
		 * ```typescript
		 * user.tracks.cameras?.forEach(camera => {
		 *   if (camera.trackName && camera.enabled) {
		 *     const [sessionId, trackName] = camera.trackName.split('/')
		 *     const track$ = partyTracks.pull(of({ sessionId, trackName, location: 'remote' }))
		 *     // Render track in video tile
		 *   }
		 * })
		 * ```
		 */
		cameras?: {
			/** Stable hardware device identifier (e.g., from MediaDeviceInfo) */
			deviceId: string

			/** Full track identifier: "sessionId/trackName" */
			trackName?: string

			/** Whether this camera is currently enabled (false = paused but allocated) */
			enabled: boolean
		}[]
	}
}

export type RoomState = {
	meetingId?: string
	users: User[]
	ai: {
		enabled: boolean
		controllingUser?: string
		error?: string
		connectionPending?: boolean
	}
}

export type ServerMessage =
	| {
			type: 'roomState'
			state: RoomState
	  }
	| {
			type: 'error'
			error?: string
	  }
	| {
			type: 'directMessage'
			from: string
			message: string
	  }
	| {
			type: 'muteMic'
	  }
	| {
			type: 'partyserver-pong'
	  }
	| {
			type: 'e2eeMlsMessage'
			payload: string
	  }
	| {
			type: 'userLeftNotification'
			id: string
	  }

export type ClientMessage =
	| {
			type: 'userUpdate'
			user: User
	  }
	| {
			type: 'directMessage'
			to: string
			message: string
	  }
	| {
			type: 'muteUser'
			id: string
	  }
	| {
			type: 'userLeft'
	  }
	| {
			type: 'partyserver-ping'
	  }
	| {
			type: 'heartbeat'
	  }
	| {
			type: 'enableAi'
			instructions?: string
			voice?: string
	  }
	| {
			type: 'disableAi'
	  }
	| {
			type: 'requestAiControl'
			track: TrackObject
	  }
	| {
			type: 'relenquishAiControl'
	  }
	| {
			type: 'callsApiHistoryEntry'
			entry: ApiHistoryEntry
			sessionId?: string
	  }
	| {
			type: 'e2eeMlsMessage'
			payload: string
	  }
