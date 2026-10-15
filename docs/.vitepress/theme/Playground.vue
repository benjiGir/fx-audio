<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from "vue"
import { withBase } from "vitepress"
import type { EffectName, GroupName, Playground, Point } from "./playground.ts"

const effectNames: Array<EffectName> = ["jump", "coin", "boom"]
const groupNames: Array<GroupName> = ["master", "music", "effects"]
const padSize = 10 // metres, from -5 to 5 on each axis

const status = ref<"idle" | "loading" | "ready" | "failed">("idle")
const failure = ref("")
const lines = ref<Array<string>>([])
const state = reactive({
  volume: { master: 1, music: 1, effects: 1 } as Record<GroupName, number>,
  muted: { master: false, music: false, effects: false } as Record<GroupName, boolean>,
  music: false,
  pan: 0,
  panOn: false,
  spaceOn: false,
  point: { x: 3, z: -2 } as Point
})
let playground: Playground | undefined

const log = (line: string) => {
  lines.value = [...lines.value, line].slice(-8)
}

const start = async () => {
  status.value = "loading"
  try {
    // Loaded on the click, not with the page: the page costs nothing until you play.
    const { createPlayground } = await import("./playground.ts")
    playground = await createPlayground(withBase("/"), log)
    status.value = "ready"
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
    status.value = "failed"
  }
}

const toggleMusic = async () => {
  if (state.music) await playground?.stopMusic()
  else await playground?.startMusic()
  state.music = !state.music
}

const setVolume = (group: GroupName, event: Event) => {
  const volume = Number((event.target as HTMLInputElement).value)
  state.volume[group] = volume
  void playground?.setVolume(group, volume)
}

const fade = (group: GroupName, volume: number) => {
  state.volume[group] = volume
  void playground?.fadeTo(group, volume, 2000)
}

const toggleMute = (group: GroupName) => {
  state.muted[group] = playground?.toggleMute(group) ?? false
}

const togglePan = () => {
  if (state.panOn) void playground?.stopPan()
  else void playground?.startPan(state.pan)
  state.panOn = !state.panOn
}

const movePan = (event: Event) => {
  state.pan = Number((event.target as HTMLInputElement).value)
  if (state.panOn) void playground?.setPan(state.pan)
}

const toggleSpace = () => {
  if (state.spaceOn) void playground?.stopSpace()
  else void playground?.startSpace(state.point)
  state.spaceOn = !state.spaceOn
}

const movePoint = (event: PointerEvent) => {
  if (event.buttons === 0 && event.type === "pointermove") return
  const pad = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const clamp = (n: number) => Math.min(0.5, Math.max(-0.5, n))
  state.point = {
    x: clamp((event.clientX - pad.left) / pad.width - 0.5) * padSize,
    z: clamp((event.clientY - pad.top) / pad.height - 0.5) * padSize
  }
  if (state.spaceOn) void playground?.setPosition(state.point)
}

const dot = () => ({
  left: `${(state.point.x / padSize + 0.5) * 100}%`,
  top: `${(state.point.z / padSize + 0.5) * 100}%`
})

onBeforeUnmount(() => void playground?.dispose())
</script>

<template>
  <div class="playground">
    <div v-if="status !== 'ready'" class="start">
      <button class="primary" :disabled="status === 'loading'" @click="start">
        {{ status === "loading" ? "Loading sounds..." : "Enable audio" }}
      </button>
      <p v-if="status === 'idle'">
        Browsers keep audio off until you interact with the page. This loads three small sounds and
        builds an
        <code>Audio</code> from <code>fx-audio/promise</code>.
      </p>
      <p v-if="status === 'failed'" class="error">Could not start: {{ failure }}</p>
    </div>

    <template v-else>
      <section>
        <h2 id="sprites">Sprites</h2>
        <p>
          Three effects live in one file and are played by name, on the <code>effects</code> group.
        </p>
        <div class="row">
          <button v-for="name in effectNames" :key="name" @click="playground?.playEffect(name)">
            {{ name }}
          </button>
        </div>
      </section>

      <section>
        <h2 id="groups">Groups and master</h2>
        <p>
          The music is streamed through the <code>music</code> group. Each group has its own volume
          and mute, and everything goes through the master.
        </p>
        <div class="row">
          <button @click="toggleMusic">{{ state.music ? "Stop music" : "Play music" }}</button>
          <button @click="fade('music', 0)">Fade music out (2 s)</button>
          <button @click="fade('music', 1)">Fade music in (2 s)</button>
        </div>
        <div v-for="group in groupNames" :key="group" class="slider">
          <label :for="`volume-${group}`">{{ group }}</label>
          <input
            :id="`volume-${group}`"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="state.volume[group]"
            @input="setVolume(group, $event)"
          />
          <button :aria-pressed="state.muted[group]" @click="toggleMute(group)">
            {{ state.muted[group] ? "Unmute" : "Mute" }}
          </button>
        </div>
      </section>

      <section>
        <h2 id="pan">Stereo pan</h2>
        <p>
          A looping ping. Use headphones: <code>voice.setPan</code> moves it between the two ears
          while it plays.
        </p>
        <div class="row">
          <button @click="togglePan">{{ state.panOn ? "Stop" : "Start" }}</button>
        </div>
        <div class="slider">
          <label for="pan-value">pan {{ state.pan.toFixed(2) }}</label>
          <input
            id="pan-value"
            type="range"
            min="-1"
            max="1"
            step="0.01"
            :value="state.pan"
            @input="movePan"
          />
        </div>
      </section>

      <section>
        <h2 id="spatial">3D position</h2>
        <p>
          You are the circle in the middle, facing up. Drag the dot:
          <code>voice.setPosition</code> moves the sound around you.
        </p>
        <div class="row">
          <button @click="toggleSpace">{{ state.spaceOn ? "Stop" : "Start" }}</button>
        </div>
        <div
          class="pad"
          role="application"
          aria-label="Position of the sound around the listener"
          @pointerdown="
            ;($event.currentTarget as HTMLElement).setPointerCapture($event.pointerId)
            movePoint($event)
          "
          @pointermove="movePoint"
        >
          <span class="listener" />
          <span class="source" :style="dot()" />
        </div>
      </section>

      <section>
        <h2 id="code">What ran</h2>
        <pre class="log"><code>{{ lines.join("\n") || "// Press a button." }}</code></pre>
      </section>
    </template>
  </div>
</template>

<style scoped>
.playground {
  margin-top: 24px;
}
section {
  margin-bottom: 32px;
}
h2 {
  margin-top: 0;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}
button {
  padding: 6px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 20px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.2s;
}
button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
}
button:disabled {
  opacity: 0.6;
  cursor: wait;
}
button[aria-pressed="true"] {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
.primary {
  background: var(--vp-c-brand-3);
  border-color: var(--vp-c-brand-3);
  color: var(--vp-c-white);
}
.slider {
  display: grid;
  grid-template-columns: 7rem 1fr auto;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
}
.slider label {
  font-variant-numeric: tabular-nums;
}
.pad {
  position: relative;
  width: min(100%, 260px);
  aspect-ratio: 1;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  touch-action: none;
  cursor: crosshair;
}
.listener,
.source {
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.listener {
  left: 50%;
  top: 50%;
  border: 2px solid var(--vp-c-text-2);
}
.source {
  background: var(--vp-c-brand-1);
}
.log {
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  overflow-x: auto;
  font-size: 0.875em;
}
.error {
  color: var(--vp-c-danger-1);
}
</style>
