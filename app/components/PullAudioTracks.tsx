/**
 * PullAudioTracks Component
 *
 * This component manages pulling and automatically playing remote audio tracks.
 * It subscribes to multiple audio tracks via PartyTracks and handles playback
 * in HTML <audio> elements.
 *
 * Key Responsibilities:
 * 1. Pull audio tracks from remote participants using track identifiers
 * 2. Automatically play audio in hidden <audio> elements
 * 3. Provide pulled tracks to child components via React Context
 * 4. Handle track lifecycle (add, remove, cleanup)
 *
 * Why Separate Audio Component?
 * - Audio tracks can be managed centrally (all played in one place)
 * - Video tracks need individual rendering (one video element per track)
 * - Audio mixing is handled automatically by the browser
 *
 * Data Flow:
 * Track Identifiers (strings) → AudioStream → partyTracks.pull() → MediaStreamTracks → <audio> elements
 *
 * Usage Example:
 * ```tsx
 * <PullAudioTracks audioTracks={["session1/audio-1", "session2/audio-2"]}>
 *   <YourUIComponents />
 * </PullAudioTracks>
 * ```
 *
 * The component automatically:
 * - Pulls all specified audio tracks
 * - Creates <audio> elements for each
 * - Plays them (browser mixes automatically)
 * - Cleans up when tracks are removed or component unmounts
 */

import type { FC, ReactNode } from 'react'
import { createContext, useContext, useState } from 'react'
import { AudioStream } from './AudioStream'

interface PullAudioTracksProps {
	/** Array of audio track identifiers in format "sessionId/trackName" */
	audioTracks: string[]

	/** Child components that may need access to pulled audio tracks */
	children?: ReactNode
}

/**
 * AudioTrackContext
 *
 * Provides pulled audio MediaStreamTracks to child components.
 * Key: track identifier string
 * Value: MediaStreamTrack object
 */
const AudioTrackContext = createContext<Record<string, MediaStreamTrack>>({})

/**
 * PullAudioTracks Component
 *
 * Pulls and plays audio from remote participants.
 *
 * How it works:
 * 1. Receives array of audio track identifiers
 * 2. AudioStream component pulls each track via PartyTracks
 * 3. When track is ready, callback adds it to audioTrackMap state
 * 4. AudioStream creates <audio> element and plays track
 * 5. Context provides tracks to child components
 *
 * Audio Mixing:
 * Multiple audio tracks play simultaneously and are mixed by the browser.
 * You don't need to manually mix - the browser handles it automatically.
 */
export const PullAudioTracks: FC<PullAudioTracksProps> = ({
	audioTracks,
	children,
}) => {
	/**
	 * Audio Track State
	 *
	 * Maps track identifiers to MediaStreamTrack objects.
	 * Updated by AudioStream callbacks when tracks are added/removed.
	 */
	const [audioTrackMap, setAudioTrackMap] = useState<
		Record<string, MediaStreamTrack>
	>({})

	return (
		<AudioTrackContext.Provider value={audioTrackMap}>
			{/*
			  AudioStream Component

			  Handles the actual track pulling and audio element creation.
			  Calls onTrackAdded/onTrackRemoved when track state changes.
			*/}
			<AudioStream
				tracksToPull={audioTracks}
				onTrackAdded={(id, track) =>
					setAudioTrackMap((previous) => ({
						...previous,
						[id]: track,
					}))
				}
				onTrackRemoved={(id) => {
					setAudioTrackMap((previous) => {
						const update = { ...previous }
						delete update[id]
						return update
					})
				}}
			/>
			{children}
		</AudioTrackContext.Provider>
	)
}

/**
 * usePulledAudioTracks Hook
 *
 * Returns all currently pulled audio tracks.
 *
 * @returns Record<string, MediaStreamTrack> - Map of track ID to MediaStreamTrack
 *
 * Usage:
 * ```tsx
 * const audioTracks = usePulledAudioTracks()
 * console.log('Active audio tracks:', Object.keys(audioTracks))
 * ```
 */
export function usePulledAudioTracks() {
	return useContext(AudioTrackContext)
}

/**
 * usePulledAudioTrack Hook
 *
 * Returns a specific audio track by identifier.
 *
 * @param track - Track identifier string ("sessionId/trackName")
 * @returns MediaStreamTrack | undefined
 *
 * Usage:
 * ```tsx
 * const audioTrack = usePulledAudioTrack("session1/audio-1")
 * if (audioTrack) {
 *   // Do something with the track
 * }
 * ```
 *
 * Note: Typically you don't need this hook because audio is played automatically.
 * Use it if you need direct access to the MediaStreamTrack for analysis, etc.
 */
export function usePulledAudioTrack(track?: string) {
	const tracks = usePulledAudioTracks()
	return track ? tracks[track] : undefined
}
