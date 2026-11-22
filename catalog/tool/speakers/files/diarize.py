#!/usr/bin/env python3
"""Run sherpa-onnx offline speaker diarization on a 16 kHz mono wav.
usage: diarize.py <wav> <segmentation.onnx> <embedding.onnx> <num_speakers|0> [threshold]
prints JSON: {"segments":[{"start":s,"end":e,"speaker":0}], "seconds": n}"""
import sys, json, wave
import numpy as np
import sherpa_onnx

wav, seg, emb, n = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
thr = float(sys.argv[5]) if len(sys.argv) > 5 else 0.85
with wave.open(wav, "rb") as w:
    assert w.getnchannels() == 1 and w.getsampwidth() == 2, "need 16-bit mono wav"
    sr = w.getframerate()
    samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
    segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
        pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=seg), num_threads=2),
    embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=emb, num_threads=2),
    clustering=sherpa_onnx.FastClusteringConfig(num_clusters=n if n > 0 else -1, threshold=thr),
    min_duration_on=0.3, min_duration_off=0.5)
sd = sherpa_onnx.OfflineSpeakerDiarization(config)
assert sd.sample_rate == sr, f"need {sd.sample_rate} Hz"
res = sd.process(samples).sort_by_start_time()
print(json.dumps({"segments": [{"start": round(r.start, 3), "end": round(r.end, 3), "speaker": r.speaker} for r in res]}))
