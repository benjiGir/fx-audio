# Autoplay and interruptions

Browsers keep a new `AudioContext` suspended until the page has seen a user gesture. The browser layer resumes it on the
first click, key press or touch, then stops listening; a gesture the browser refuses leaves the listeners in place for the next one.

To be sure sound starts at once, call `audio.resume` from your own handler (a `Promise<void>` method on the promise facade).
It does nothing on a running context.

<<< @/examples/autoplay.ts#autoplay{ts}

A voice started before the first gesture waits on the suspended context and starts playing when it runs.

## After an interruption

A phone suspends or interrupts a running context too: an incoming call, the lock screen, a tab sent to the background,
Safari's `interrupted` state. The browser layer watches the context and recovers by itself:

- when the context stops running, it listens for the next click, key press or touch and resumes on it;
- when the tab becomes visible again, it tries to resume at once, because a page that already had a gesture is often allowed to;
- as soon as the context runs again, it stops listening.

Voices that were playing when the interruption began carry on from where the browser left them; you do not have to start them again.
Nothing to configure, and `audio.resume` stays available if you would rather resume from your own handler.
