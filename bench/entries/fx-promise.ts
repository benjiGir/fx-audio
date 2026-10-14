import { createAudio } from "../../src/promise.ts"

const audio = createAudio()
audio.play(await audio.load("a.wav"))
