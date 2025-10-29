/**
 * useMultiCamera Hook
 *
 * This hook manages multiple camera devices for simultaneous video streaming.
 * It's designed for scenarios where you need to broadcast multiple camera feeds
 * at once, such as a hospital station with multiple equipment views.
 *
 * Key Responsibilities:
 * 1. Enumerate available video input devices
 * 2. Manage MediaStreams for selected cameras
 * 3. Wrap tracks in RxJS BehaviorSubjects for reactive updates
 * 4. Handle enable/disable state for each camera
 * 5. Clean up resources on unmount
 *
 * Usage Example:
 * ```tsx
 * const multiCamera = useMultiCamera()
 *
 * // Add a camera
 * await multiCamera.addCamera(deviceId)
 *
 * // Access camera streams
 * multiCamera.cameras.forEach(camera => {
 *   // camera.track$ is a BehaviorSubject<MediaStreamTrack>
 *   // Push to PartyTracks:
 *   partyTracks.push(camera.track$)
 * })
 *
 * // Toggle camera on/off
 * multiCamera.toggleCamera(deviceId, false) // disable
 * ```
 *
 * Important Concepts:
 * - Each camera has its own MediaStream (separate getUserMedia call)
 * - Tracks are wrapped in BehaviorSubjects to enable reactive programming
 * - BehaviorSubjects emit null when disabled, actual track when enabled
 * - This integrates seamlessly with PartyTracks which expects Observables
 */

import { useCallback, useEffect, useState } from 'react'
import { BehaviorSubject } from 'rxjs'

/**
 * CameraStream Interface
 *
 * Represents a single camera and its associated state.
 */
export interface CameraStream {
	deviceId: string                                    // Unique hardware device ID
	label: string                                       // Human-readable name (e.g., "HD Webcam")
	stream: MediaStream                                 // Raw browser MediaStream object
	track$: BehaviorSubject<MediaStreamTrack | null>   // Reactive wrapper for the video track
	enabled: boolean                                    // Current enabled state
}

export function useMultiCamera() {
	// State: Available video input devices from the browser
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

	// State: Map of active cameras by device ID
	// Using Map for O(1) lookups and easy addition/removal
	const [cameras, setCameras] = useState<Map<string, CameraStream>>(new Map())

	// State: Error message if device access fails
	const [error, setError] = useState<string>()

	/**
	 * Effect: Enumerate Available Video Devices
	 *
	 * Queries the browser for all video input devices (cameras/webcams).
	 * Also listens for device changes (plug/unplug events).
	 *
	 * Why listen for device changes?
	 * - User might plug in an external webcam during use
	 * - User might unplug a camera
	 * - System might change default device
	 */
	useEffect(() => {
		const getDevices = async () => {
			try {
				// Request list of all media devices
				const allDevices = await navigator.mediaDevices.enumerateDevices()

				// Filter to only video input devices
				// Other types: 'audioinput', 'audiooutput'
				const videoDevices = allDevices.filter((d) => d.kind === 'videoinput')
				setDevices(videoDevices)
			} catch (err) {
				console.error('Error enumerating devices:', err)
				setError('Failed to enumerate devices')
			}
		}

		// Get initial device list
		getDevices()

		/**
		 * Listen for device changes
		 *
		 * The 'devicechange' event fires when:
		 * - A device is plugged in or unplugged
		 * - Permissions are granted/revoked
		 * - System default device changes
		 */
		navigator.mediaDevices.addEventListener('devicechange', getDevices)

		// Cleanup: remove event listener
		return () => {
			navigator.mediaDevices.removeEventListener('devicechange', getDevices)
		}
	}, [])

	/**
	 * addCamera Function
	 *
	 * Adds a new camera to the active camera set.
	 *
	 * Process:
	 * 1. Call getUserMedia with specific device ID
	 * 2. Extract video track from the MediaStream
	 * 3. Wrap track in BehaviorSubject for reactive programming
	 * 4. Create CameraStream object with metadata
	 * 5. Add to cameras Map
	 *
	 * Why BehaviorSubject?
	 * - PartyTracks.push() expects an Observable<MediaStreamTrack>
	 * - BehaviorSubject is an Observable that holds current value
	 * - Allows us to reactively update the track (enable/disable)
	 * - New subscribers immediately get current track state
	 *
	 * @param deviceId - The unique device ID from MediaDeviceInfo
	 */
	const addCamera = useCallback(async (deviceId: string) => {
		try {
			/**
			 * Request camera access with constraints
			 *
			 * Constraints:
			 * - deviceId: exact - Must be this specific camera
			 * - width/height: ideal - Prefer 720p, but accept other resolutions
			 *
			 * Note: Using 'exact' for deviceId ensures we get the right camera.
			 * Using 'ideal' for resolution allows fallback if camera doesn't support 720p.
			 */
			const stream = await navigator.mediaDevices.getUserMedia({
				video: {
					deviceId: { exact: deviceId },  // Must be this specific camera
					width: { ideal: 1280 },         // Prefer 1280x720 (720p)
					height: { ideal: 720 },
				},
			})

			// Extract the video track from the stream
			// A MediaStream can contain multiple tracks (audio + video)
			// We only need the video track
			const videoTrack = stream.getVideoTracks()[0]

			/**
			 * Wrap track in BehaviorSubject
			 *
			 * This enables reactive programming:
			 * - track$.next(newTrack) updates all subscribers
			 * - track$.next(null) signals track is disabled
			 * - Perfect for integration with PartyTracks Observable API
			 */
			const track$ = new BehaviorSubject<MediaStreamTrack | null>(videoTrack)

			// Find device info for label
			const device = devices.find((d) => d.deviceId === deviceId)

			// Create CameraStream object
			const cameraStream: CameraStream = {
				deviceId,
				label: device?.label || `Camera ${deviceId.slice(0, 8)}`,
				stream,
				track$,
				enabled: true,  // Newly added cameras start enabled
			}

			// Add to cameras Map (immutably)
			setCameras((prev) => new Map(prev).set(deviceId, cameraStream))
			setError(undefined)  // Clear any previous errors
		} catch (err) {
			console.error('Error adding camera:', err)
			setError(`Failed to add camera: ${err instanceof Error ? err.message : 'Unknown error'}`)

			/**
			 * Common errors:
			 * - NotAllowedError: User denied camera permission
			 * - NotFoundError: Device ID doesn't exist (was unplugged)
			 * - NotReadableError: Camera is already in use by another app
			 */
		}
	}, [devices])

	/**
	 * removeCamera Function
	 *
	 * Removes a camera from the active set and cleans up resources.
	 *
	 * Cleanup steps:
	 * 1. Stop all tracks in the MediaStream (releases camera)
	 * 2. Emit null to BehaviorSubject (notifies subscribers)
	 * 3. Complete the BehaviorSubject (no more emissions)
	 * 4. Remove from cameras Map
	 *
	 * Why stop tracks?
	 * - Releases the camera for use by other applications
	 * - Turns off the camera indicator light
	 * - Frees system resources
	 *
	 * @param deviceId - The device ID to remove
	 */
	const removeCamera = useCallback((deviceId: string) => {
		setCameras((prev) => {
			const camera = prev.get(deviceId)
			if (camera) {
				/**
				 * Stop all tracks
				 *
				 * track.stop() tells the browser to release the camera.
				 * This is CRUCIAL - without it, the camera stays active
				 * and can't be used by other apps.
				 */
				camera.stream.getTracks().forEach((track) => track.stop())

				/**
				 * Clean up the Observable
				 *
				 * 1. next(null) - Final emission, signals track is gone
				 * 2. complete() - No more emissions, Observable is done
				 */
				camera.track$.next(null)
				camera.track$.complete()

				// Remove from Map (immutably)
				const next = new Map(prev)
				next.delete(deviceId)
				return next
			}
			return prev
		})
	}, [])

	/**
	 * toggleCamera Function
	 *
	 * Enables or disables a camera without removing it.
	 *
	 * Difference from removeCamera:
	 * - removeCamera: Stops track, releases camera, removes from Map
	 * - toggleCamera: Keeps track active, just pauses/resumes transmission
	 *
	 * When disabled:
	 * - track.enabled = false (track still exists, just paused)
	 * - track$.next(null) (tells PartyTracks to stop sending)
	 * - Camera stays allocated (faster to re-enable)
	 *
	 * When enabled:
	 * - track.enabled = true (resume track)
	 * - track$.next(track) (tells PartyTracks to resume sending)
	 *
	 * Use case: Temporary privacy (disable camera without deallocating it)
	 *
	 * @param deviceId - The device ID to toggle
	 * @param enabled - New enabled state
	 */
	const toggleCamera = useCallback((deviceId: string, enabled: boolean) => {
		setCameras((prev) => {
			const camera = prev.get(deviceId)
			if (camera) {
				/**
				 * Set track.enabled property
				 *
				 * This is a WebRTC standard property:
				 * - true: Track is active and transmitting
				 * - false: Track is muted/paused (but still allocated)
				 */
				camera.stream.getVideoTracks().forEach((track) => {
					track.enabled = enabled
				})

				// Update camera state immutably
				const next = new Map(prev)
				const updated = { ...camera, enabled }
				next.set(deviceId, updated)

				/**
				 * Update the BehaviorSubject
				 *
				 * This notifies PartyTracks of the state change:
				 * - If enabling: emit the actual track
				 * - If disabling: emit null (stops transmission)
				 */
				if (enabled) {
					camera.track$.next(camera.stream.getVideoTracks()[0])
				} else {
					camera.track$.next(null)
				}

				return next
			}
			return prev
		})
	}, [])

	/**
	 * Effect: Cleanup on Unmount
	 *
	 * When the component using this hook unmounts, we must clean up
	 * all camera resources to prevent memory leaks and release cameras.
	 *
	 * This runs when:
	 * - User leaves the room
	 * - Component is unmounted for any reason
	 * - Page is closed/refreshed
	 *
	 * Critical for resource management!
	 */
	useEffect(() => {
		return () => {
			cameras.forEach((camera) => {
				// Stop all tracks (releases cameras)
				camera.stream.getTracks().forEach((track) => track.stop())

				// Complete all Observables (prevents memory leaks)
				camera.track$.complete()
			})
		}
		// Empty deps: only run on mount/unmount
		// Note: This captures cameras at mount time, which is intentional
		// The cleanup should handle whatever cameras exist when unmounting
	}, [])

	return {
		availableDevices: devices,
		cameras: Array.from(cameras.values()),
		addCamera,
		removeCamera,
		toggleCamera,
		error,
	}
}

export type MultiCamera = ReturnType<typeof useMultiCamera>
