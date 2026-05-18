import { loadCanvas } from '@/lib/canvas/loader';
import { layoutCanvas } from '@/lib/canvas/layout';
import { PaperclipEnvError } from '@/lib/paperclip/env';
import { PaperclipApiError } from '@/lib/paperclip/client';

import { CanvasClient } from './canvas-client';
import { CanvasErrorState } from './canvas-error';

export const dynamic = 'force-dynamic';

export default async function CanvasPage() {
  try {
    const { bundle, source } = await loadCanvas();
    const layout = layoutCanvas(bundle.nodes);
    return (
      <CanvasClient
        initialBundle={bundle}
        initialLayout={layout}
        initialSource={source}
        pollIntervalMs={20_000}
      />
    );
  } catch (err) {
    if (err instanceof PaperclipEnvError) {
      return (
        <CanvasErrorState
          headline="Canvas needs Paperclip credentials"
          body={`Set the missing env vars and reload: ${err.missing.join(', ')}.`}
        />
      );
    }
    if (err instanceof PaperclipApiError) {
      return (
        <CanvasErrorState
          headline="Paperclip upstream failed"
          body={`${err.endpoint} returned ${err.status}. Retry once Paperclip is reachable.`}
        />
      );
    }
    throw err;
  }
}
