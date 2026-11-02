#!/usr/bin/env python3
"""Scores a recording against the clean voice it was made from.

  python3 scripts/audio-quality.py clean.wav recording.mp4 [recording2.webm ...]

The browser plays the clean file in a loop as a fake microphone, so the recording starts somewhere inside it. The script
finds that point, cuts out the matching stretch of the clean file and compares the two with PESQ (wideband, 1 to 4.5)
and STOI (0 to 1). Higher is better for both. Needs: ffmpeg, numpy, scipy, pesq, pystoi.
"""
import subprocess, sys, tempfile, os
import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve
from pesq import pesq
from pystoi import stoi

RATE = 16000

def load(path):
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, "x.wav")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-vn", "-ac", "1", "-ar", str(RATE), out], check=True)
        _, data = wavfile.read(out)
    return data.astype(np.float64) / 32768.0

def best_offset(reference, recording):
    """Where in the (looped) reference does the recording start? Compared on a smoothed loudness curve, which survives codecs."""
    hop = 160  # 10 ms
    def env(x):
        n = len(x) // hop
        return np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(axis=1))
    loops = int(np.ceil((len(recording) + len(reference)) / len(reference))) + 1
    looped = np.tile(reference, loops)
    a, b = env(looped), env(recording)
    a, b = a - a.mean(), b - b.mean()
    corr = fftconvolve(a, b[::-1], mode="valid")
    best = int(np.argmax(corr[: len(reference) // hop]))
    return best * hop, looped

def main():
    ref = load(sys.argv[1])
    print(f"{'file':44} {'PESQ':>6} {'STOI':>6}")
    for path in sys.argv[2:]:
        rec = load(path)
        start, looped = best_offset(ref, rec)
        n = min(len(rec), len(looped) - start)
        # fine alignment, to the sample, on the waveform itself: where does the recording sit inside the clean stretch?
        window = looped[start : start + n]
        margin = 800
        seg = rec[margin : n - margin]
        cc = fftconvolve(window, seg[::-1], mode="valid")
        k = int(np.argmax(np.abs(cc)))
        a = window[k : k + len(seg)]
        b = seg[: len(a)]
        sec = min(len(a), 12 * RATE)
        a, b = a[:sec], b[:sec]
        try: p = pesq(RATE, a, b, "wb")
        except Exception as e: p = float("nan")
        s = stoi(a, b, RATE, extended=True)
        print(f"{os.path.basename(path):44} {p:6.2f} {s:6.3f}")

main()
