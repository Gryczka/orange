/**
 * Hospital Station Route
 *
 * This component provides the hospital-side interface for remote medical equipment support.
 * It enables hospital staff to broadcast multiple camera feeds simultaneously to remote technicians.
 *
 * Key Features:
 * - Multi-camera management: Add, remove, enable/disable multiple camera feeds
 * - Local camera previews: Hospital staff can see what they're broadcasting
 * - Real-time video track pushing: Each camera is pushed as a separate WebRTC track
 * - Two-way audio communication with technicians
 * - View incoming technician video feeds
 *
 * Video Track Flow:
 * 1. useMultiCamera hook manages multiple camera MediaStreams
 * 2. Each camera track is wrapped in an RxJS BehaviorSubject
 * 3. Tracks are pushed to Cloudflare Calls via partyTracks.push()
 * 4. Track metadata (sessionId/trackName) is broadcast via WebSocket
 * 5. Technicians receive metadata and pull tracks via partyTracks.pull()
 *
 * See ARCHITECTURE.md for detailed data flow diagrams.
 */

import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json } from '@remix-run/cloudflare'
import { useLoaderData, useNavigate, useParams } from '@remix-run/react'
import { useEffect, useState, useMemo } from 'react'
import { useObservableAsValue } from 'partytracks/react'
import { ButtonLink, Button } from '~/components/Button'
import { CopyButton } from '~/components/CopyButton'
import { HighPacketLossWarningsToast } from '~/components/HighPacketLossWarningsToast'
import { IceDisconnectedToast } from '~/components/IceDisconnectedToast'
import { LeaveRoomButton } from '~/components/LeaveRoomButton'
import { MicButton } from '~/components/MicButton'
import { OverflowMenu } from '~/components/OverflowMenu'
import { ParticipantLayout } from '~/components/ParticipantLayout'
import { PullAudioTracks } from '~/components/PullAudioTracks'
import { ScreenshareButton } from '~/components/ScreenshareButton'
import { VideoSrcObject } from '~/components/VideoSrcObject'
import Toast from '~/components/Toast'
import useIsSpeaking from '~/hooks/useIsSpeaking'
import { useRoomContext } from '~/hooks/useRoomContext'
import { useShowDebugInfoShortcut } from '~/hooks/useShowDebugInfoShortcut'
import { useMultiCamera } from '~/hooks/useMultiCamera'
import { dashboardLogsLink } from '~/utils/dashboardLogsLink'
import getUsername from '~/utils/getUsername.server'
import isNonNullable from '~/utils/isNonNullable'
import type { ClientMessage, User } from '~/types/Messages'
import { of, type Observable } from 'rxjs'

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
	const username = await getUsername(request)

	return json({
		username,
		bugReportsEnabled: Boolean(
			context.env.FEEDBACK_URL &&
				context.env.FEEDBACK_QUEUE &&
				context.env.FEEDBACK_STORAGE
		),
		mode: context.mode,
		hasDb: Boolean(context.env.DB),
		dashboardDebugLogsBaseUrl: context.env.DASHBOARD_WORKER_URL,
	})
}

export default function HospitalStation() {
	const { joined } = useRoomContext()
	const navigate = useNavigate()
	const { roomName } = useParams()
	const { mode } = useLoaderData<typeof loader>()

	useEffect(() => {
		if (!joined && mode !== 'development')
			navigate(`/${roomName}`)
	}, [joined, mode, navigate, roomName])

	if (!joined && mode !== 'development') return null

	return (
		<Toast.Provider>
			<JoinedHospitalStation />
		</Toast.Provider>
	)
}

function JoinedHospitalStation() {
	const { hasDb, bugReportsEnabled, dashboardDebugLogsBaseUrl } =
		useLoaderData<typeof loader>()
	const {
		userMedia,
		partyTracks,
		pushedTracks,
		showDebugInfo,
		room,
	} = useRoomContext()
	const {
		otherUsers,
		websocket,
		identity,
		roomState: { meetingId },
	} = room

	useShowDebugInfoShortcut()

	const speaking = useIsSpeaking(userMedia.audioStreamTrack)

	// Multi-camera management hook
	// This hook handles:
	// - Enumerating available video devices
	// - Creating MediaStreams for selected cameras
	// - Managing camera enable/disable state
	// - Wrapping each track in an RxJS BehaviorSubject for reactive updates
	const multiCamera = useMultiCamera()

	// Get the current PartyTracks session ID
	// This identifies our WebRTC peer connection and will be part of each track identifier
	// Format: trackIdentifier = `${sessionId}/${trackName}`
	const { sessionId } = useObservableAsValue(partyTracks.session$) ?? {}

	/**
	 * Camera Track Metadata State
	 *
	 * Stores the published track information for each active camera.
	 * This metadata is broadcast to other participants via WebSocket so they know
	 * which tracks to pull from Cloudflare Calls.
	 *
	 * Note: This stores track IDENTIFIERS, not the actual video data.
	 * Video data flows through Cloudflare Calls infrastructure.
	 */
	const [cameraTracksInfo, setCameraTracksInfo] = useState<
		Array<{
			deviceId: string        // Hardware device ID (stable identifier)
			trackName?: string      // Full track identifier: "sessionId/trackName"
			enabled: boolean        // Whether camera is currently enabled
		}>
	>([])

	/**
	 * Dependency optimization for useEffect
	 *
	 * We use a comma-separated string of device IDs instead of the cameras array
	 * directly to prevent useEffect from re-running when camera objects are
	 * recreated but device IDs haven't actually changed.
	 */
	const cameraDeviceIds = useMemo(
		() => multiCamera.cameras.map((c) => c.deviceId).join(','),
		[multiCamera.cameras]
	)

	/**
	 * Effect: Push Camera Tracks to Cloudflare Calls
	 *
	 * This effect is responsible for publishing camera video tracks to the WebRTC infrastructure.
	 *
	 * Flow:
	 * 1. For each active camera from useMultiCamera hook:
	 *    a. Call partyTracks.push() with the camera's track$ Observable
	 *    b. Configure encoding parameters (framerate, bitrate)
	 *    c. Subscribe to the pushed track Observable
	 * 2. When partyTracks successfully publishes a track:
	 *    a. We receive the track metadata (sessionId, trackName)
	 *    b. Store this metadata in cameraTracksInfo state
	 *    c. This metadata will be broadcast via WebSocket in the next effect
	 * 3. On cleanup:
	 *    a. Unsubscribe from all track Observables
	 *    b. Remove track metadata for removed cameras
	 *
	 * Important: The video data itself doesn't pass through our code after push().
	 * Cloudflare Calls handles the WebRTC peer connection and media relay (SFU).
	 */
	useEffect(() => {
		const subscriptions = new Map<string, () => void>()

		console.log('[HOSPITAL] Setting up camera tracks, count:', multiCamera.cameras.length)

		// Push each camera track to Cloudflare Calls
		multiCamera.cameras.forEach((camera) => {
			console.log('[HOSPITAL] Pushing camera track:', camera.deviceId, camera.label)

			/**
			 * partyTracks.push() publishes a track to Cloudflare Calls
			 *
			 * Parameters:
			 * - camera.track$: BehaviorSubject<MediaStreamTrack> - reactive track source
			 * - sendEncodings$: Observable of encoding parameters
			 *   - maxFramerate: 24 fps (reasonable for video conferencing)
			 *   - maxBitrate: 1.2 Mbps (good quality without excessive bandwidth)
			 *
			 * Returns: Observable that emits pushed track metadata when ready
			 */
			const pushed$ = partyTracks.push(camera.track$ as Observable<MediaStreamTrack>, {
				sendEncodings$: of([
					{
						maxFramerate: 24,          // Limit to 24 frames per second
						maxBitrate: 1_200_000,     // ~1.2 Mbps max bandwidth per camera
					},
				]),
			})

			// Subscribe to track publishing updates
			const subscription = pushed$.subscribe((pushedTrack) => {
				console.log('[HOSPITAL] Pushed track update for camera:', camera.deviceId, pushedTrack)

				setCameraTracksInfo((prev) => {
					// Remove any existing entry for this camera
					const filtered = prev.filter((t) => t.deviceId !== camera.deviceId)

					// If track was successfully pushed, add its metadata
					if (pushedTrack) {
						const newTrack = {
							deviceId: camera.deviceId,
							// Combine sessionId and trackName into full identifier
							// Format: "sessionId/trackName"
							trackName: `${pushedTrack.sessionId}/${pushedTrack.trackName}`,
							enabled: camera.enabled,
						}
						console.log('[HOSPITAL] Adding camera track info:', newTrack)
						return [...filtered, newTrack]
					}
					return filtered
				})
			})

			// Store cleanup function for this subscription
			subscriptions.set(camera.deviceId, () => subscription.unsubscribe())
		})

		// Cleanup: remove metadata for cameras that are no longer active
		setCameraTracksInfo((prev) => {
			const currentDeviceIds = new Set(multiCamera.cameras.map((c) => c.deviceId))
			return prev.filter((t) => currentDeviceIds.has(t.deviceId))
		})

		// Cleanup function: unsubscribe from all track Observables
		return () => {
			subscriptions.forEach((unsubscribe) => unsubscribe())
		}
		// Re-run only when the set of camera device IDs changes
	}, [cameraDeviceIds, partyTracks])

	/**
	 * Effect: Broadcast User Status via WebSocket
	 *
	 * This effect broadcasts the hospital station's current state to all participants
	 * in the room, including track metadata for all active cameras.
	 *
	 * Key Responsibilities:
	 * 1. Construct a User object with role='hospital' and all track identifiers
	 * 2. Serialize camera track metadata for transmission
	 * 3. Send userUpdate message via WebSocket to Durable Object
	 * 4. Durable Object broadcasts to all connected participants (technicians, etc.)
	 *
	 * Data Flow:
	 * Hospital (this component) → WebSocket → Durable Object → Broadcast to All Participants
	 *
	 * Important Concepts:
	 * - Track IDENTIFIERS (strings) are sent via WebSocket
	 * - Actual VIDEO DATA flows separately through Cloudflare Calls
	 * - This separation allows signaling and media to use different transports
	 * - Technicians use these identifiers to pull tracks via partyTracks.pull()
	 *
	 * The User object structure defines what information is available to other participants:
	 * - role: 'hospital' (identifies this as a hospital station)
	 * - tracks.cameras: Array of camera metadata
	 * - tracks.audio/screenshare: Standard track identifiers
	 */
	useEffect(() => {
		const id = identity?.id
		const name = identity?.name

		// Only broadcast if we have identity and connection
		if (id && name && sessionId && websocket) {
			/**
			 * Serialize camera track information for WebSocket transmission
			 *
			 * Each camera object contains:
			 * - deviceId: Stable hardware identifier
			 * - trackName: Full track identifier ("sessionId/trackName")
			 * - enabled: Current enable/disable state
			 */
			const serializedCameras = cameraTracksInfo.map(camera => ({
				deviceId: camera.deviceId,
				trackName: camera.trackName || undefined,
				enabled: camera.enabled,
			}))

			/**
			 * Construct the User object representing this hospital station
			 *
			 * The 'tracks' property contains identifiers for all media tracks:
			 * - audio: Single audio track identifier
			 * - cameras: Array of video track identifiers (multi-camera support)
			 * - screenshare: Screen sharing track identifier (if active)
			 * - video: Unused for hospital role (cameras are used instead)
			 */
			const user: User = {
				id,
				name,
				role: 'hospital' as const,              // Identifies this as a hospital station
				joined: true,
				raisedHand: false,
				speaking,                               // Derived from audio level detection
				transceiverSessionId: sessionId,        // WebRTC session identifier
				tracks: {
					audio: pushedTracks.audio,
					audioEnabled: userMedia.audioEnabled,
					audioUnavailable: userMedia.audioUnavailableReason !== undefined,
					video: undefined,                   // Hospital uses cameras array instead
					videoEnabled: false,
					screenshare: pushedTracks.screenshare,
					screenShareEnabled: userMedia.screenShareEnabled,
					// Multiple cameras - this is the key difference from regular participants
					cameras: serializedCameras.length > 0 ? serializedCameras : undefined,
				},
			}

			console.log('[HOSPITAL] Broadcasting user update:', {
				role: user.role,
				cameraCount: serializedCameras.length,
				cameras: serializedCameras,
			})

			try {
				/**
				 * Send userUpdate message via WebSocket
				 *
				 * Message flow:
				 * 1. This message goes to the Durable Object (ChatRoom.server.ts)
				 * 2. Durable Object updates its room state
				 * 3. Durable Object broadcasts roomState to all participants
				 * 4. Technicians receive the update and can pull our camera tracks
				 */
				const message = JSON.stringify({
					type: 'userUpdate',
					user,
				} satisfies ClientMessage)
				console.log('[HOSPITAL] Message to send:', message.substring(0, 500))
				websocket.send(message)
			} catch (error) {
				console.error('[HOSPITAL] Error sending message:', error)
			}
		}
	}, [
		// Re-broadcast whenever any of these values change
		identity,
		sessionId,
		websocket,
		speaking,
		pushedTracks.audio,
		pushedTracks.screenshare,
		userMedia.audioEnabled,
		userMedia.audioUnavailableReason,
		userMedia.screenShareEnabled,
		cameraTracksInfo,                    // Includes all camera track metadata
	])

	/**
	 * Filter to show only technician users
	 *
	 * Hospital stations typically only need to see technicians who are providing
	 * remote support. Other hospital stations or regular participants are filtered out.
	 */
	const technicianUsers = otherUsers.filter((u) => u.role === 'technician')

	console.log('[HOSPITAL] Technician users:', technicianUsers.map(u => ({
		id: u.id,
		name: u.name,
		role: u.role,
		hasVideo: !!u.tracks.video,
		videoTrack: u.tracks.video,
	})))

	const gridGap = 12

	return (
		/**
		 * PullAudioTracks Component
		 *
		 * This component handles pulling and mixing audio tracks from remote participants.
		 * It takes an array of audio track identifiers and:
		 * 1. Subscribes to each audio track via partyTracks.pull()
		 * 2. Creates MediaStreamTrack objects for each
		 * 3. Automatically plays them in <audio> elements
		 * 4. Handles track cleanup when participants leave
		 *
		 * Note: Audio is handled separately from video for better control.
		 * All technician audio is mixed automatically by the browser.
		 */
		<PullAudioTracks
			audioTracks={technicianUsers
				.map((u) => u.tracks.audio)
				.filter(isNonNullable)}
		>
			<div className="flex flex-col h-full bg-white dark:bg-zinc-800">
				<div className="relative flex-grow bg-black isolate">
					<div
						style={{ '--gap': gridGap + 'px' } as any}
						className="absolute inset-0 flex flex-col isolate p-[--gap] gap-[--gap]"
					>
						{/* ===== CAMERA MANAGEMENT SECTION ===== */}
						{/*
						  This section allows hospital staff to:
						  1. See all available video input devices
						  2. Add/remove cameras from the active set
						  3. Preview what each camera sees
						  4. Enable/disable individual cameras

						  Each active camera is:
						  - Pushed to Cloudflare Calls (see useEffect above)
						  - Broadcast in the User object via WebSocket
						  - Visible to all connected technicians
						*/}
						<div className="bg-zinc-900 p-4 rounded">
							<h3 className="text-white font-bold mb-2">Hospital Cameras</h3>

							{/* Camera Selection Buttons */}
							<div className="flex flex-wrap gap-2 mb-4">
								{multiCamera.availableDevices.map((device) => {
									// Check if this camera is currently active
									const isActive = multiCamera.cameras.some(
										(c) => c.deviceId === device.deviceId
									)
									return (
										<Button
											key={device.deviceId}
											onClick={() => {
												if (isActive) {
													// Remove camera: stops track and removes from state
													multiCamera.removeCamera(device.deviceId)
												} else {
													// Add camera: calls getUserMedia and pushes track
													multiCamera.addCamera(device.deviceId)
												}
											}}
											displayType={isActive ? 'primary' : 'secondary'}
											className="text-xs"
										>
											{isActive ? '✓ ' : '+ '}
											{device.label || `Camera ${device.deviceId.slice(0, 8)}`}
										</Button>
									)
								})}
							</div>

							{/* Error Display */}
							{multiCamera.error && (
								<p className="text-red-400 text-sm">{multiCamera.error}</p>
							)}

							{/* Active Camera Previews */}
							{/*
							  Shows a local preview of each active camera.
							  This helps hospital staff verify camera positioning
							  before technicians join.
							*/}
							<div className="grid grid-cols-2 gap-2">
								{multiCamera.cameras.map((camera) => (
									<div key={camera.deviceId} className="relative">
										{/* VideoSrcObject binds MediaStreamTrack to video element */}
										<VideoSrcObject
											videoTrack={camera.stream.getVideoTracks()[0]}
											className="w-full aspect-video bg-black rounded"
											muted
										/>
										{/* Camera Label */}
										<div className="absolute bottom-2 left-2 text-white text-xs bg-black/50 px-2 py-1 rounded">
											{camera.label}
										</div>
										{/* Enable/Disable Toggle */}
										{/*
										  Disabling stops the track from being sent (via BehaviorSubject.next(null))
										  but keeps the camera allocated. Useful for temporary privacy.
										*/}
										<button
											onClick={() =>
												multiCamera.toggleCamera(
													camera.deviceId,
													!camera.enabled
												)
											}
											className="absolute top-2 right-2 bg-black/50 text-white px-2 py-1 rounded text-xs"
										>
											{camera.enabled ? 'Disable' : 'Enable'}
										</button>
									</div>
								))}
							</div>
						</div>

						{/* ===== TECHNICIAN VIEW SECTION ===== */}
						{/*
						  This section displays video feeds from connected technicians.
						  Allows two-way video communication during remote support sessions.
						*/}
						<div className="flex-grow overflow-hidden relative">
							{technicianUsers.length > 0 ? (
								/**
								 * ParticipantLayout Component
								 *
								 * Automatically arranges participant video tiles in a responsive grid.
								 * Handles:
								 * - Dynamic grid sizing based on participant count
								 * - Aspect ratio maintenance
								 * - Video track pulling and rendering
								 */
								<ParticipantLayout
									users={technicianUsers.filter(isNonNullable)}
									gap={gridGap}
									aspectRatio="16:9"
								/>
							) : (
								// Empty state: No technicians connected yet
								<div className="flex items-center justify-center h-full text-white">
									<div className="text-center">
										<h2 className="text-2xl font-bold mb-2">
											Hospital Station
										</h2>
										<p className="text-gray-400">
											Waiting for technician to join...
										</p>
									</div>
								</div>
							)}
						</div>
					</div>
					<Toast.Viewport className="absolute bottom-0 right-0" />
				</div>
				<div className="flex flex-wrap items-center justify-center gap-2 p-2 text-sm md:gap-4 md:p-5 md:text-base">
					<MicButton warnWhenSpeakingWhileMuted />
					<ScreenshareButton />
					<OverflowMenu bugReportsEnabled={bugReportsEnabled} />
					<LeaveRoomButton
						navigateToFeedbackPage={hasDb}
						meetingId={meetingId}
					/>
					{showDebugInfo && meetingId && (
						<CopyButton contentValue={meetingId}>Meeting Id</CopyButton>
					)}
					{showDebugInfo && meetingId && dashboardDebugLogsBaseUrl && (
						<ButtonLink
							className="text-xs"
							displayType="secondary"
							to={dashboardLogsLink(dashboardDebugLogsBaseUrl, [
								{
									id: '2',
									key: 'meetingId',
									type: 'string',
									value: meetingId,
									operation: 'eq',
								},
							])}
							target="_blank"
							rel="noreferrer"
						>
							Meeting Logs
						</ButtonLink>
					)}
				</div>
			</div>
			<HighPacketLossWarningsToast />
			<IceDisconnectedToast />
		</PullAudioTracks>
	)
}
