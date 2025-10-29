/**
 * usePulledVideoTrack Hook
 *
 * This hook subscribes to a remote video track using PartyTracks and returns
 * the MediaStreamTrack for rendering in a video element.
 *
 * Key Responsibilities:
 * 1. Parse track identifier string ("sessionId/trackName")
 * 2. Construct TrackObject for PartyTracks
 * 3. Subscribe to the remote track via partyTracks.pull()
 * 4. Return the MediaStreamTrack for rendering
 * 5. Handle track changes reactively
 *
 * Data Flow:
 * Track Identifier (string) → Parse → TrackObject → partyTracks.pull() → MediaStreamTrack
 *
 * Usage Example:
 * ```tsx
 * const videoTrack = usePulledVideoTrack("session-abc/video-1")
 *
 * return (
 *   <video ref={(el) => {
 *     if (el && videoTrack) {
 *       el.srcObject = new MediaStream([videoTrack])
 *     }
 *   }} />
 * )
 * ```
 *
 * This hook is used by:
 * - Participant component (to render remote video tiles)
 * - Technician station (to display hospital camera feeds)
 * - Regular meeting room (to display other participants)
 *
 * Important Concepts:
 * - Track identifier format: "sessionId/trackName"
 * - Observable-based: Track updates are reactive
 * - Simulcast support: Can request specific quality levels
 */

import { useObservableAsValue, useValueAsObservable } from 'partytracks/react'
import { useMemo } from 'react'
import { of, switchMap } from 'rxjs'
import { useRoomContext } from '~/hooks/useRoomContext'
import type { TrackObject } from '~/utils/callsTypes'

/**
 * usePulledVideoTrack Hook
 *
 * @param video - Track identifier string in format "sessionId/trackName", or undefined
 * @param preferredRid - Optional: Preferred resolution ID for simulcast (e.g., "h" for high, "m" for medium, "l" for low)
 * @returns MediaStreamTrack | undefined - The pulled video track, or undefined if not available
 */
export function usePulledVideoTrack(
	video: string | undefined,
	preferredRid?: string
) {
	const { partyTracks, simulcastEnabled } = useRoomContext()

	/**
	 * Parse Track Identifier
	 *
	 * Track identifiers follow the format "sessionId/trackName"
	 * Example: "abc123def456/video-camera-1"
	 *
	 * sessionId: Identifies the WebRTC peer connection
	 * trackName: Unique name for the specific track within that session
	 */
	const [sessionId, trackName] = video?.split('/') ?? []

	/**
	 * Construct TrackObject
	 *
	 * TrackObject is the format expected by PartyTracks.pull()
	 * It specifies:
	 * - trackName: The track's unique name
	 * - sessionId: The peer connection session
	 * - location: 'remote' (we're pulling someone else's track)
	 *
	 * Memoized to prevent recreating on every render
	 */
	const trackObject = useMemo(
		() =>
			sessionId && trackName
				? ({
						trackName,
						sessionId,
						location: 'remote',
					} satisfies TrackObject)
				: undefined,
		[sessionId, trackName]
	)

	/**
	 * Convert to Observables
	 *
	 * PartyTracks works with RxJS Observables for reactive updates.
	 * We convert our React state values to Observables.
	 */
	const preferredRid$ = useValueAsObservable(preferredRid)
	const trackObject$ = useValueAsObservable(trackObject)

	/**
	 * Pull Track via PartyTracks
	 *
	 * This is where the actual WebRTC subscription happens.
	 *
	 * Flow:
	 * 1. trackObject$ emits a new TrackObject (or undefined)
	 * 2. switchMap cancels previous subscription and creates new one
	 * 3. If track exists: partyTracks.pull() subscribes to remote track
	 * 4. If track is undefined: emit undefined
	 * 5. Observable emits MediaStreamTrack when ready
	 *
	 * Simulcast Support:
	 * If enabled, we can request a specific quality level (preferredRid):
	 * - "h": High quality (full resolution)
	 * - "m": Medium quality (half resolution)
	 * - "l": Low quality (quarter resolution)
	 */
	const pulledTrack$ = useMemo(
		() =>
			trackObject$.pipe(
				switchMap((track) =>
					track
						? partyTracks.pull(
								of(track),
								// Optional simulcast configuration
								simulcastEnabled ? { simulcast: { preferredRid$ } } : undefined
							)
						: of(undefined)
				)
			),
		[trackObject$, partyTracks, simulcastEnabled, preferredRid$]
	)

	/**
	 * Convert Observable to React State
	 *
	 * useObservableAsValue subscribes to the Observable and returns
	 * the current value as React state, triggering re-renders on changes.
	 *
	 * Returns: MediaStreamTrack | undefined
	 */
	return useObservableAsValue(pulledTrack$)
}
