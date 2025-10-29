/**
 * useBroadcastStatus Hook
 *
 * This hook handles broadcasting a user's current state to all participants in the room
 * via WebSocket. It sends updates whenever the user's media tracks or status changes.
 *
 * Key Responsibilities:
 * 1. Construct User object with current state
 * 2. Send userUpdate messages via WebSocket
 * 3. Handle reconnection (resend state when WebSocket reconnects)
 * 4. Send leaving notification on unmount
 *
 * Data Flow:
 * Local State → User Object → WebSocket → Durable Object → Broadcast to All Participants
 *
 * Usage:
 * ```tsx
 * useBroadcastStatus({
 *   userMedia,
 *   partyTracks,
 *   websocket,
 *   identity,
 *   pushedTracks,
 *   raisedHand: false,
 *   speaking,
 *   role: 'technician',
 * })
 * ```
 *
 * This hook is used by all three roles:
 * - Regular participants: Standard camera/audio
 * - Hospital stations: Multiple cameras (handled separately in hospital route)
 * - Technicians: Standard camera/audio with role='technician'
 */

import { useEffect } from 'react'
import { useUnmount } from 'react-use'
import type { ClientMessage, User, UserRole } from '~/types/Messages'

import type PartySocket from 'partysocket'
import type { PartyTracks } from 'partytracks/client'
import { useObservableAsValue } from 'partytracks/react'
import type { RoomContextType } from './useRoomContext'
import type { UserMedia } from './useUserMedia'

/**
 * Configuration for useBroadcastStatus hook
 */
interface Config {
	/** User media state (camera, microphone, screen share) */
	userMedia: UserMedia

	/** PartyTracks instance for session ID */
	partyTracks: PartyTracks

	/** User identity (id, name) */
	identity?: User

	/** WebSocket connection to Durable Object */
	websocket: PartySocket

	/** Track identifiers returned from partyTracks.push() */
	pushedTracks: RoomContextType['pushedTracks']

	/** Whether user has hand raised */
	raisedHand: boolean

	/** Whether user is currently speaking */
	speaking: boolean

	/** User role (regular, hospital, technician) */
	role?: UserRole
}

export default function useBroadcastStatus({
	userMedia,
	identity,
	websocket,
	partyTracks,
	pushedTracks,
	raisedHand,
	speaking,
	role,
}: Config) {
	// Extract media state from userMedia
	const {
		audioEnabled,
		videoEnabled,
		screenShareEnabled,
		audioUnavailableReason,
	} = userMedia

	// Extract track identifiers from pushedTracks
	// These are strings in format "sessionId/trackName"
	const { audio, video, screenshare } = pushedTracks

	// Get the current WebRTC session ID from PartyTracks
	const { sessionId } = useObservableAsValue(partyTracks.session$) ?? {}

	const audioUnavailable = audioUnavailableReason !== undefined

	const id = identity?.id
	const name = identity?.name

	/**
	 * Effect: Broadcast User Status
	 *
	 * This effect runs whenever any dependency changes (track state, speaking, etc.)
	 * and broadcasts the updated user state to all participants.
	 *
	 * Key behaviors:
	 * 1. Sends immediately when any state changes
	 * 2. Re-sends on WebSocket reconnection (via 'open' event)
	 * 3. Only broadcasts if identity is available
	 *
	 * Why re-send on 'open'?
	 * - WebSocket can disconnect due to network issues
	 * - When it reconnects, the server has lost our state
	 * - We must re-broadcast our current state
	 */
	useEffect(() => {
		if (id && name) {
			/**
			 * Construct User object
			 *
			 * This object represents our current state and will be
			 * sent to the Durable Object, which broadcasts it to all participants.
			 *
			 * Note: Hospital stations override this logic and manually
			 * construct their User object with the cameras array.
			 */
			const user: User = {
				id,
				name,
				joined: true,
				raisedHand,
				speaking,
				transceiverSessionId: sessionId,
				role,
				tracks: {
					audioEnabled,
					audioUnavailable,
					videoEnabled,
					screenShareEnabled,
					video,       // Track identifier: "sessionId/trackName"
					audio,       // Track identifier: "sessionId/trackName"
					screenshare, // Track identifier: "sessionId/trackName"
				},
			}

			/**
			 * Send userUpdate message via WebSocket
			 *
			 * Message flow:
			 * 1. This client → WebSocket → Durable Object
			 * 2. Durable Object updates room state
			 * 3. Durable Object broadcasts to all connected participants
			 * 4. Other participants receive roomState message with our User object
			 */
			function sendUserUpdate() {
				websocket.send(
					JSON.stringify({
						type: 'userUpdate',
						user,
					} satisfies ClientMessage)
				)
			}

			// Send immediately
			sendUserUpdate()

			/**
			 * Handle WebSocket reconnection
			 *
			 * The 'open' event fires when the WebSocket connects or reconnects.
			 * When reconnecting, we must re-send our state because the server
			 * has lost track of us during the disconnection.
			 */
			websocket.addEventListener('open', sendUserUpdate)

			// Cleanup: remove event listener
			return () => websocket.removeEventListener('open', sendUserUpdate)
		}
	}, [
		// Re-run effect when any of these values change
		id,
		name,
		websocket,
		sessionId,
		audio,                   // Track identifier
		video,                   // Track identifier
		screenshare,             // Track identifier
		audioEnabled,            // Enable/disable state
		videoEnabled,
		screenShareEnabled,
		raisedHand,              // UI state
		speaking,                // Audio level detection
		audioUnavailableReason,
		audioUnavailable,
		role,                    // User role
	])

	useUnmount(() => {
		if (id && name) {
			websocket.send(
				JSON.stringify({
					type: 'userUpdate',
					user: {
						id,
						name,
						joined: false,
						raisedHand,
						speaking,
						transceiverSessionId: sessionId,
						tracks: {
							audioUnavailable,
						},
					},
				} satisfies ClientMessage)
			)
		}
	})
}
