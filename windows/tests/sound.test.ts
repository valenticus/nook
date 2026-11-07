import assert from "node:assert/strict";
import test from "node:test";

import { SoundEngine } from "../src/core/sound.ts";

test("mute immediately silences an already-playing sound and volume changes stay muted", async () => {
  const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  const previousFetch = globalThis.fetch;
  const sources: Array<{ connectedTo: unknown; started: boolean }> = [];
  const masters: Array<{ gain: { value: number }; connect(): void }> = [];
  class FakeAudioContext {
    state = "running";
    destination = {};
    createGain() {
      const gain = { gain: { value: 0 }, connect() {} };
      masters.push(gain);
      return gain;
    }
    createBufferSource() {
      const source = {
        buffer: null,
        connectedTo: null as unknown,
        started: false,
        connect(node: unknown) { this.connectedTo = node; },
        start() { this.started = true; },
      };
      sources.push(source);
      return source;
    }
    async decodeAudioData() { return {} as AudioBuffer; }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
  }
  const fakeWindow = {
    AudioContext: FakeAudioContext as unknown as typeof AudioContext,
    setTimeout: () => 1,
    clearTimeout: () => {},
  };

  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  globalThis.fetch = (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }) as Response) as typeof fetch;
  try {
    const sound = new SoundEngine();
    await sound.preload();
    const master = masters[0]!;
    sound.setVolume(0.12);
    sound.play("approval");

    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.started, true);
    assert.equal(sources[0]?.connectedTo, master);
    assert.equal(master.gain.value, 0.12);

    sound.setEnabled(false);
    assert.equal(master.gain.value, 0, "the master output silences the source already playing");
    sound.play("finish");
    assert.equal(sources.length, 1, "muted playback does not start another source");

    sound.setVolume(0.08);
    assert.equal(master.gain.value, 0, "changing volume cannot unmute the engine");
    sound.setEnabled(true);
    assert.equal(master.gain.value, 0.08, "unmuting restores the selected volume");

    const initiallyMuted = new SoundEngine();
    initiallyMuted.setEnabled(false);
    await initiallyMuted.preload();
    assert.equal(masters[1]?.gain.value, 0, "preloading while muted never opens the master output");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete (globalThis as typeof globalThis & { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});
