/**
 * Technician Station Route
 *
 * This component provides the technician-side interface for remote medical equipment support.
 * It enables remote technicians to view multiple camera feeds from hospital sites and
 * provide real-time guidance to on-site staff.
 *
 * Key Features:
 * - Multi-feed viewing: Display all hospital camera feeds in a grid layout
 * - Automatic feed management: Each hospital camera appears as a separate video tile
 * - Screen share viewing: Hospital screen shares appear as additional tiles
 * - Two-way audio communication with hospital staff
 * - Optional video: Technicians can share their own camera if needed
 *
 * Video Track Flow (Receiving):
 * 1. Receive WebSocket message with User object containing cameras array
 * 2. Transform cameras array into virtual "feed" objects
 * 3. For each feed, extract the track identifier (sessionId/trackName)
 * 4. Use usePulledVideoTrack hook to subscribe via partyTracks.pull()
 * 5. Render each pulled track in a separate video tile
 *
 * Important: This component RECEIVES tracks that the hospital station PUSHES.
 * It does not manage multiple cameras itself - it displays multiple remote cameras.
 *
 * See ARCHITECTURE.md for detailed data flow diagrams.
 */

import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json } from '@remix-run/cloudflare'
import { useLoaderData, useNavigate, useParams } from '@remix-run/react'
import { useEffect, useState } from 'react'
import { ButtonLink } from '~/components/Button'
import { CameraButton } from '~/components/CameraButton'
import { CopyButton } from '~/components/CopyButton'
import { HighPacketLossWarningsToast } from '~/components/HighPacketLossWarningsToast'
import { IceDisconnectedToast } from '~/components/IceDisconnectedToast'
import { LeaveRoomButton } from '~/components/LeaveRoomButton'
import { MicButton } from '~/components/MicButton'
import { OverflowMenu } from '~/components/OverflowMenu'
import { ParticipantLayout } from '~/components/ParticipantLayout'
import { PullAudioTracks } from '~/components/PullAudioTracks'
import Toast from '~/components/Toast'
import useBroadcastStatus from '~/hooks/useBroadcastStatus'
import useIsSpeaking from '~/hooks/useIsSpeaking'
import { useRoomContext } from '~/hooks/useRoomContext'
import { useShowDebugInfoShortcut } from '~/hooks/useShowDebugInfoShortcut'
import { dashboardLogsLink } from '~/utils/dashboardLogsLink'
import getUsername from '~/utils/getUsername.server'
import isNonNullable from '~/utils/isNonNullable'

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

export default function TechnicianStation() {
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
			<JoinedTechnicianStation />
		</Toast.Provider>
	)
}

function JoinedTechnicianStation() {
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

	/**
	 * useBroadcastStatus hook
	 *
	 * Broadcasts this technician's status to all participants via WebSocket.
	 * Similar to hospital station but with role='technician' and typically
	 * only a single camera/video track.
	 */
	useBroadcastStatus({
		userMedia,
		partyTracks,
		websocket,
		identity,
		pushedTracks,
		raisedHand: false,
		speaking,
		role: 'technician',
	})

	/**
	 * Filter to show only hospital users
	 *
	 * Technicians typically only need to see hospital camera feeds.
	 * Other technicians or regular participants are filtered out to
	 * maintain focus on the equipment being supported.
	 */
	const hospitalUsers = otherUsers.filter((u) => u.role === 'hospital')

	console.log('[TECHNICIAN] Hospital users:', hospitalUsers.map(u => ({
		id: u.id,
		name: u.name,
		role: u.role,
		cameraCount: u.tracks.cameras?.length || 0,
		cameras: u.tracks.cameras,
	})))

	/**
	 * Transform hospital users into individual video feeds
	 *
	 * This is a KEY CONCEPT for understanding multi-camera display:
	 *
	 * Problem: A hospital user has a `cameras` array with multiple track identifiers.
	 * Solution: "Explode" each camera into a separate virtual user for layout purposes.
	 *
	 * Example transformation:
	 *
	 * INPUT (from WebSocket):
	 * {
	 *   id: "hospital-1",
	 *   name: "Hospital A",
	 *   tracks: {
	 *     cameras: [
	 *       { trackName: "session1/video-1", enabled: true },
	 *       { trackName: "session1/video-2", enabled: true },
	 *       { trackName: "session1/video-3", enabled: true }
	 *     ],
	 *     screenshare: "session1/screen-1"
	 *   }
	 * }
	 *
	 * OUTPUT (for rendering):
	 * [
	 *   { id: "hospital-1-camera-dev1", name: "Hospital A - Camera 1", tracks: { video: "session1/video-1" } },
	 *   { id: "hospital-1-camera-dev2", name: "Hospital A - Camera 2", tracks: { video: "session1/video-2" } },
	 *   { id: "hospital-1-camera-dev3", name: "Hospital A - Camera 3", tracks: { video: "session1/video-3" } },
	 *   { id: "hospital-1-screenshare", name: "Hospital A - Screen", tracks: { video: "session1/screen-1" } }
	 * ]
	 *
	 * Why? The ParticipantLayout and Participant components expect one video track per user.
	 * By creating virtual users, we can reuse existing components without modification.
	 */
	const hospitalFeeds = hospitalUsers.flatMap((user) => {
		const feeds = []

		/**
		 * Transform each camera into a separate "virtual user"
		 *
		 * Each camera feed becomes a tile in the grid. The track identifier
		 * is moved from the cameras array to the standard video field.
		 */
		if (user.tracks.cameras && user.tracks.cameras.length > 0) {
			user.tracks.cameras.forEach((camera, index) => {
				// Only create a feed if the camera has a valid track name and is enabled
				if (camera.trackName && camera.enabled) {
					feeds.push({
						...user,  // Inherit all user properties
						// Create unique ID combining user ID and device ID
						id: `${user.id}-camera-${camera.deviceId}`,
						// Add camera number to name for clarity
						name: `${user.name} - Camera ${index + 1}`,
						tracks: {
							...user.tracks,
							// Move camera track to standard video field
							// This allows Participant component to pull it normally
							video: camera.trackName,
							videoEnabled: camera.enabled,
							// Remove multi-camera fields
							screenshare: undefined,
							screenShareEnabled: false,
							cameras: undefined,  // Important: prevent infinite recursion
						},
					})
				}
			})
		}

		/**
		 * Transform screenshare into a separate "virtual user"
		 *
		 * Screen shares are treated as separate tiles for better visibility.
		 * Often screen shares contain important diagnostic information.
		 */
		if (user.tracks.screenshare) {
			feeds.push({
				...user,
				id: `${user.id}-screenshare`,
				name: `${user.name} - Screen`,
				tracks: {
					...user.tracks,
					// Move screenshare to video field for standard rendering
					video: user.tracks.screenshare,
					videoEnabled: user.tracks.screenShareEnabled,
					// Clear multi-camera and screenshare fields
					screenshare: undefined,
					screenShareEnabled: false,
					cameras: undefined,
				},
			})
		}

		console.log('[TECHNICIAN] Created feeds for user:', user.name, 'Feed count:', feeds.length)

		return feeds
	})

	const gridGap = 12

	return (
		/**
		 * PullAudioTracks Component
		 *
		 * Pulls and mixes audio from all hospital users.
		 * Note: We pull audio from the original hospitalUsers, not the transformed feeds,
		 * because each hospital user has only one audio track regardless of camera count.
		 *
		 * Audio tracks are handled separately from video:
		 * - Video: Multiple tracks per user (one per camera)
		 * - Audio: Single track per user (mixed at technician's end)
		 */
		<PullAudioTracks
			audioTracks={hospitalUsers
				.map((u) => u.tracks.audio)
				.filter(isNonNullable)}
		>
			<div className="flex flex-col h-full bg-white dark:bg-zinc-800">
				<div className="relative flex-grow bg-black isolate">
					<div
						style={{ '--gap': gridGap + 'px' } as any}
						className="absolute inset-0 flex isolate p-[--gap] gap-[--gap]"
					>
						{/* ===== HOSPITAL CAMERA FEEDS SECTION ===== */}
						{/*
						  This section displays all hospital camera feeds in a responsive grid.
						  Each camera and screen share appears as a separate tile.

						  Behind the scenes (handled by ParticipantLayout and Participant components):
						  1. For each feed, Participant component extracts tracks.video
						  2. usePulledVideoTrack hook parses "sessionId/trackName"
						  3. partyTracks.pull() subscribes to the track from Cloudflare Calls
						  4. MediaStreamTrack is rendered in a <video> element
						*/}
						<div className="flex-grow overflow-hidden relative">
							{hospitalFeeds.length > 0 ? (
								/**
								 * ParticipantLayout Component
								 *
								 * Renders the transformed hospital feeds in a responsive grid.
								 * Each "virtual user" (camera or screenshare) gets its own tile.
								 *
								 * Key behaviors:
								 * - Automatically calculates grid dimensions based on feed count
								 * - Maintains 16:9 aspect ratio for video tiles
								 * - Handles track pulling via Participant component
								 * - Responds to window resize
								 *
								 * Example with 3 cameras + 1 screenshare = 4 tiles in 2x2 grid
								 */
								<ParticipantLayout
									users={hospitalFeeds.filter(isNonNullable)}
									gap={gridGap}
									aspectRatio="16:9"
								/>
							) : (
								// Empty state: No hospital users connected yet
								<div className="flex items-center justify-center h-full text-white">
									<div className="text-center">
										<h2 className="text-2xl font-bold mb-2">
											Technician Station
										</h2>
										<p className="text-gray-400">
											Waiting for hospital to join...
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
					<CameraButton />
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
