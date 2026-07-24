import { describe, it, expect } from 'vitest';
import { pickAudioRecording } from '../../src/zoom';

describe('pickAudioRecording', () => {
  it('selects the audio_only M4A among mixed files and takes duration from the file', () => {
    // The exact shape your live account returned: M4A + TIMELINE + MP4.
    const r = pickAudioRecording({
      uuid: 'abc/def==',
      topic: 'Session 3',
      start_time: '2026-05-07T18:00:00Z',
      duration: 90,
      recording_files: [
        { id: 'mp4', recording_type: 'shared_screen_with_speaker_view', file_type: 'MP4', file_size: 99999 },
        { id: 'tl', recording_type: 'timeline', file_type: 'TIMELINE' },
        {
          id: 'aud',
          recording_type: 'audio_only',
          file_type: 'M4A',
          file_extension: 'M4A',
          file_size: 12345,
          recording_start: '2026-05-07T18:00:05Z',
          recording_end: '2026-05-07T18:05:05Z',
        },
      ],
    });
    expect(r).toMatchObject({ meetingUuid: 'abc/def==', topic: 'Session 3', fileId: 'aud', sizeBytes: 12345 });
    expect(r?.durationSec).toBe(300); // 5 min from recording_start/end, not the coarse meeting minutes
  });

  it('falls back to meeting duration (minutes) when the file has no start/end', () => {
    const r = pickAudioRecording({
      uuid: 'x',
      duration: 12,
      recording_files: [{ id: 'a', recording_type: 'audio_only', file_type: 'M4A' }],
    });
    expect(r?.durationSec).toBe(720);
  });

  it('matches by M4A extension even when recording_type is absent', () => {
    const r = pickAudioRecording({
      uuid: 'x',
      recording_files: [{ id: 'a', file_type: 'M4A', file_extension: 'M4A' }],
    });
    expect(r?.fileId).toBe('a');
  });

  it('returns null when there is no audio-only file (video only)', () => {
    const r = pickAudioRecording({
      uuid: 'x',
      recording_files: [{ id: 'v', recording_type: 'shared_screen_with_speaker_view', file_type: 'MP4' }],
    });
    expect(r).toBeNull();
  });
});
