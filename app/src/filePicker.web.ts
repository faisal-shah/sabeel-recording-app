/**
 * Web side of the audio-picker seam (native sibling: filePicker.ts).
 *
 * Staff upload from the big screen: this is a plain file input, which needs no
 * dependency and gives the OS picker for free.
 */
export const canPickAudio = true;

export function pickAudioFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.m4a,.mp3,.aac,.wav';
    // Resolving null on cancel rather than never settling: a promise that hangs
    // would leave the button spinning with no way back.
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}
