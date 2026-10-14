import { createAudio } from "fx-audio/promise"

declare const button: HTMLButtonElement

// #region autoplay
const audio = createAudio()
button.addEventListener("click", () => audio.resume())
// #endregion autoplay
