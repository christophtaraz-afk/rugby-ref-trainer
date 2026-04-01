#!/usr/bin/env python3
"""
Rugby Referee Whistle Detection Tool

Analyzes audio from a YouTube video to detect referee whistle blows.
Outputs timestamps as JSON for use with the Rugby Ref Trainer app.

Usage:
    python detect_whistles.py --url "https://youtube.com/watch?v=VIDEO_ID"
    python detect_whistles.py --url "https://youtube.com/watch?v=VIDEO_ID" --output whistles.json
    python detect_whistles.py --file audio.wav
    python detect_whistles.py --url "..." --buildup 25 --aftermath 15 --clips-json

Dependencies: yt-dlp, scipy, numpy
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, find_peaks


def download_audio(url, output_path):
    """Download audio from YouTube video as WAV."""
    print(f"Downloading audio from: {url}")
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--extract-audio",
        "--audio-format", "wav",
        "--audio-quality", "0",
        "--output", output_path,
        "--no-playlist",
        "--quiet",
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error downloading: {result.stderr}")
        sys.exit(1)
    print(f"Audio saved to: {output_path}")


def bandpass_filter(data, lowcut, highcut, fs, order=5):
    """Apply a bandpass filter to isolate whistle frequencies."""
    nyq = 0.5 * fs
    low = lowcut / nyq
    high = highcut / nyq
    sos = butter(order, [low, high], btype="band", output="sos")
    return sosfilt(sos, data)


def detect_whistles(audio_path, min_confidence=0.3, min_gap_seconds=5.0):
    """
    Detect referee whistle sounds in audio.

    Rugby referee whistles typically produce a strong tone in the 2-5 kHz range
    that sustains for 0.3-2.0 seconds.

    Returns list of dicts: [{"time": seconds, "confidence": 0-1}, ...]
    """
    print(f"Analyzing audio: {audio_path}")

    # Load audio
    sample_rate, data = wavfile.read(audio_path)

    # Convert to mono if stereo
    if len(data.shape) > 1:
        data = data.mean(axis=1)

    # Normalize to float
    data = data.astype(np.float64)
    if data.max() > 0:
        data = data / np.max(np.abs(data))

    print(f"  Sample rate: {sample_rate} Hz")
    print(f"  Duration: {len(data) / sample_rate:.1f} seconds")

    # Bandpass filter for whistle frequencies (2-5 kHz)
    filtered = bandpass_filter(data, 2000, 5000, sample_rate)

    # Compute energy in short windows
    window_size = int(0.1 * sample_rate)  # 100ms windows
    hop_size = int(0.05 * sample_rate)  # 50ms hop

    num_windows = (len(filtered) - window_size) // hop_size + 1
    energy = np.zeros(num_windows)

    for i in range(num_windows):
        start = i * hop_size
        end = start + window_size
        window = filtered[start:end]
        energy[i] = np.sqrt(np.mean(window ** 2))

    # Normalize energy
    if energy.max() > 0:
        energy = energy / energy.max()

    # Smooth the energy curve
    kernel_size = 5
    kernel = np.ones(kernel_size) / kernel_size
    energy_smooth = np.convolve(energy, kernel, mode="same")

    # Find peaks in the whistle-band energy
    # Whistles should be prominent peaks above the background noise
    threshold = np.percentile(energy_smooth, 85)  # Top 15% of energy
    min_gap_windows = int(min_gap_seconds / 0.05)

    peaks, properties = find_peaks(
        energy_smooth,
        height=threshold,
        distance=min_gap_windows,
        prominence=0.1,
    )

    # Convert peak indices to timestamps and confidence scores
    whistles = []
    for i, peak in enumerate(peaks):
        time_seconds = peak * 0.05  # hop_size in seconds
        confidence = float(energy_smooth[peak])

        # Additional validation: check if the whistle sustains for at least 200ms
        # Look at energy in a 400ms window around the peak
        sustain_start = max(0, peak - 4)
        sustain_end = min(len(energy_smooth), peak + 4)
        sustain_energy = energy_smooth[sustain_start:sustain_end]
        sustained = np.mean(sustain_energy > threshold * 0.6)

        if sustained < 0.3:
            continue  # Not sustained enough — probably not a whistle

        # Boost confidence if well-sustained
        confidence = min(1.0, confidence * (0.5 + sustained * 0.5))

        if confidence >= min_confidence:
            whistles.append({
                "time": round(time_seconds, 1),
                "confidence": round(confidence, 3),
            })

    # Sort by time
    whistles.sort(key=lambda w: w["time"])

    print(f"  Found {len(whistles)} whistle candidates")
    return whistles


def generate_clips_json(whistles, video_id, buildup=25, aftermath=15):
    """Generate draft clips.json entries from detected whistles."""
    clips = []
    for i, w in enumerate(whistles):
        whistle_time = w["time"]
        clips.append({
            "id": f"fg_{i+1:03d}",
            "videoId": video_id,
            "title": f"Full game incident at {format_time(whistle_time)}",
            "mode": "fullgame",
            "buildUpStart": max(0, round(whistle_time - buildup)),
            "whistleTime": round(whistle_time),
            "aftermathEnd": round(whistle_time + aftermath),
            "correctDecision": "TODO",
            "category": "TODO",
            "difficulty": "medium",
            "explanation": "TODO — watch the clip and fill in the correct decision",
            "refActualCall": "TODO",
            "level": "International",
            "tags": ["men", "test-match"],
            "_confidence": w["confidence"],
        })
    return clips


def format_time(seconds):
    """Format seconds as M:SS."""
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m}:{s:02d}"


def extract_video_id(url):
    """Extract YouTube video ID from URL."""
    import re
    patterns = [
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([a-zA-Z0-9_-]{11})",
        r"^([a-zA-Z0-9_-]{11})$",
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Detect referee whistles in rugby match audio"
    )
    parser.add_argument("--url", help="YouTube video URL")
    parser.add_argument("--file", help="Path to existing audio WAV file")
    parser.add_argument("--output", "-o", help="Output JSON file (default: stdout)")
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=0.3,
        help="Minimum confidence threshold (0-1, default: 0.3)",
    )
    parser.add_argument(
        "--min-gap",
        type=float,
        default=5.0,
        help="Minimum gap between detections in seconds (default: 5.0)",
    )
    parser.add_argument(
        "--buildup",
        type=int,
        default=25,
        help="Seconds of build-up before whistle (default: 25)",
    )
    parser.add_argument(
        "--aftermath",
        type=int,
        default=15,
        help="Seconds of aftermath after whistle (default: 15)",
    )
    parser.add_argument(
        "--clips-json",
        action="store_true",
        help="Output as draft clips.json entries instead of raw timestamps",
    )
    parser.add_argument(
        "--keep-audio",
        action="store_true",
        help="Keep downloaded audio file (default: delete after processing)",
    )

    args = parser.parse_args()

    if not args.url and not args.file:
        parser.error("Either --url or --file is required")

    audio_path = args.file
    temp_dir = None

    try:
        # Download audio if URL provided
        if args.url and not args.file:
            temp_dir = tempfile.mkdtemp()
            audio_path = os.path.join(temp_dir, "audio.wav")
            download_audio(args.url, audio_path)

            # yt-dlp may add extension, find the actual file
            if not os.path.exists(audio_path):
                for f in os.listdir(temp_dir):
                    if f.endswith(".wav"):
                        audio_path = os.path.join(temp_dir, f)
                        break

        if not os.path.exists(audio_path):
            print(f"Error: Audio file not found at {audio_path}")
            sys.exit(1)

        # Detect whistles
        whistles = detect_whistles(
            audio_path,
            min_confidence=args.min_confidence,
            min_gap_seconds=args.min_gap,
        )

        # Format output
        if args.clips_json:
            video_id = extract_video_id(args.url) if args.url else "UNKNOWN"
            output = generate_clips_json(
                whistles, video_id, args.buildup, args.aftermath
            )
        else:
            output = whistles

        # Print summary
        print(f"\n{'='*50}")
        print(f"Detected {len(whistles)} whistle(s):")
        print(f"{'='*50}")
        for w in whistles:
            t = w["time"]
            print(f"  {format_time(t)} ({t:.1f}s)  confidence: {w['confidence']:.2f}")
        print()

        # Write output
        json_str = json.dumps(output, indent=2)
        if args.output:
            with open(args.output, "w") as f:
                f.write(json_str)
            print(f"Output written to: {args.output}")
        else:
            print(json_str)

    finally:
        # Cleanup
        if temp_dir and not args.keep_audio:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
