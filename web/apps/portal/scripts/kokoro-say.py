"""Speaks a batch of lines with Kokoro (Apache-2.0, runs locally) for scripts/render-guides.mjs.

Usage: kokoro-say.py <jobs.json> [voice]
jobs.json is a list of {"text": "...", "out": "/path/step.wav"}. Each line becomes a mono 24 kHz WAV.
"""

import json
import sys

import numpy as np
import soundfile as sf
from kokoro import KPipeline

SAMPLE_RATE = 24000
PAUSE_SECONDS = 0.25  # between the chunks Kokoro splits a long line into

jobs = json.load(open(sys.argv[1], encoding="utf-8"))
voice = sys.argv[2] if len(sys.argv) > 2 else "af_heart"
pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
gap = np.zeros(int(SAMPLE_RATE * PAUSE_SECONDS), dtype=np.float32)
for job in jobs:
    parts = []
    for _, _, audio in pipeline(job["text"], voice=voice, speed=0.95):
        parts.extend([np.asarray(audio, dtype=np.float32), gap])
    sf.write(job["out"], np.concatenate(parts[:-1]), SAMPLE_RATE)
