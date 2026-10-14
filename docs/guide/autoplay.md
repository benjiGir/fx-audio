# Autoplay policy

Browsers keep a new `AudioContext` suspended until the page has seen a user gesture. The browser layer resumes it on the
first click, key press or touch, then stops listening; a gesture the browser refuses leaves the listeners in place for the next one.

To be sure sound starts at once, call `audio.resume` from your own handler (a `Promise<void>` method on the promise facade).
It does nothing on a running context.

<<< @/examples/autoplay.ts#autoplay{ts}

A voice started before the first gesture waits on the suspended context and starts playing when it runs.
