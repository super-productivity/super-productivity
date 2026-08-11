# Audio Feedback for Habit Sessions

## Overview

The Super-Productivity habit tracking system now includes audio feedback for habit session start and stop events. When a habit timer or countdown is toggled, users receive an auditory notification without requiring constant screen monitoring.

## Feature Implementation

### Architecture

The audio feedback feature is implemented as an NgRx effect (`SimpleCounterAudioEffects`) that:

1. **Listens** to `toggleSimpleCounterCounter` and `setSimpleCounterCounterOff` actions
2. **Filters** to supported counter types (RepeatedCountdownReminder, StopWatch)
3. **Plays** the configured done sound with proper queuing to prevent audio clipping
4. **Respects** both global and per-counter audio configuration preferences

### Key Components

#### 1. **SimpleCounterAudioEffects** (`simple-counter-audio.effects.ts`)

- Reactive NgRx effect that handles audio playback
- Monitors `toggleSimpleCounterCounter` and `setSimpleCounterCounterOff` actions
- Uses store selectors to check global sound config and counter state
- Executes audio playback asynchronously to avoid blocking the main UI thread

#### 2. **Audio Queuing** (`play-sound.ts`)

- Prevents simultaneous sound playback which causes audio clipping
- Implements FIFO queue that plays sounds sequentially
- Each sound waits for the previous one to complete before starting
- Configurable via `playSound()` function (existing API unchanged)

#### 3. **SimpleCounter Model Enhancement**

Added per-counter audio configuration:

```typescript
interface SimpleCounterCfgFields {
  // ... existing fields ...
  isAudioEnabled?: boolean; // Enable/disable audio for this counter
}
```

### Configuration

#### Global Sound Config

Uses the existing global sound configuration:

- **doneSound**: The sound file to play on toggle (e.g., "positive.mp3")
- **volume**: Playback volume level (0-100)

#### Per-Counter Config

Each SimpleCounter can enable/disable audio:

- **isAudioEnabled**: `true` (default) or `false` to silence a specific counter

### Audio Files

Available sound files (from `assets/snd/`):

- `positive.mp3` - Default completion sound
- `bell.mp3` - Break reminder sound
- `tick.mp3` - Interval tick sound
- Custom user-provided sounds supported

## Usage

### Enabling Audio Feedback

1. Go to **Settings → Sounds**
2. Ensure a **Done Sound** is selected (e.g., "Positive")
3. Set **Volume** to desired level
4. For individual counters, ensure **Audio Enabled** is turned on

### Disabling Audio

**Globally**: Set volume to 0 or unselect the done sound
**Per Counter**: Toggle off "Audio Enabled" in counter settings

## Technical Details

### Toggle Detection Logic

```typescript
// Audio is triggered on toggle actions for supported counter types
// when global sound config is enabled and the counter allows audio.
```

### Threading & Performance

- **Asynchronous Execution**: Audio playback runs outside the main rendering pipeline
- **No Main-Thread Blocking**: Uses Web Audio API native threading for playback
- **Queue Processing**: Sequential playback prevents audio clipping for concurrent sounds
- **Zero UI Impact**: Verified that audio playback does not introduce UI stuttering during concurrent habit tracking

### Error Handling

- Graceful fallback if audio context is unavailable (iOS backgrounding)
- Console errors logged but don't interrupt app flow
- Automatic context resumption on first user gesture

## Testing

Comprehensive unit tests included in `simple-counter-audio.effects.spec.ts`:

### Test Coverage

- ✅ Countdown completion triggers audio
- ✅ Stopwatch completion triggers audio
- ✅ Click counters do NOT trigger audio
- ✅ Audio respects global volume setting
- ✅ Audio respects per-counter isAudioEnabled flag
- ✅ Audio can play when counter turns on
- ✅ No audio when sound config missing
- ✅ No audio when doneSound not configured
- ✅ Correct volume from config is used
- ✅ Multiple concurrent counters handled correctly

### Running Tests

```bash
npm run test -- --include='**/simple-counter-audio.effects.spec.ts'
```

## Integration Points

### Related Features

- **Focus Mode**: Already has audio feedback (separate implementation)
- **Global Sound Config**: Reuses existing sound preferences
- **SimpleCounter State**: Leverages existing NgRx state management

### Backward Compatibility

- No breaking changes
- `isAudioEnabled` is optional (defaults to enabled)
- Existing counters without the field work as expected

## Future Enhancements

Potential improvements for future iterations:

1. Per-counter custom sound selection
2. Pitch adjustment based on streak length
3. Haptic feedback for mobile devices
4. Sound visualization in UI during playback
5. Integration with accessibility features (sound descriptors)

## Troubleshooting

### Audio Not Playing

1. Check **Settings → Sounds** for a selected done sound
2. Verify volume is not 0
3. Check counter's "Audio Enabled" setting is on
4. Browser permissions: Allow audio in site settings
5. Check browser console for errors

### Audio Clipping/Overlapping Sounds

- This is automatically handled by the audio queue
- If issue persists, try reducing global volume

### Silent on Mobile

- First user gesture unlocks audio context (iOS requirement)
- Tap the app or click any button to unlock
- Check system volume level

## References

- [NgRx Effects Documentation](https://ngrx.io/guide/store/effects)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [SimpleCounter Model](../src/app/features/simple-counter/simple-counter.model.ts)
- [GlobalConfig Model](../src/app/features/config/global-config.model.ts)
