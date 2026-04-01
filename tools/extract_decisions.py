#!/usr/bin/env python3
"""
Extract referee decisions from YouTube commentary captions.

Uses YouTube's auto-generated subtitles to read what the commentators
say after each whistle moment, then matches against known rugby
decision keywords to suggest the correct call.

Usage:
  python extract_decisions.py --url "https://youtube.com/watch?v=VIDEO_ID" \
      --whistles whistles.json --output enriched_clips.json

  # Or provide specific timestamps to analyze:
  python extract_decisions.py --url "https://youtube.com/watch?v=VIDEO_ID" \
      --times 204,1980,3290 --output enriched_clips.json
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

# ── Decision keyword matching ──────────────────────────────────────────

# Map commentary phrases → decision categories
# Order matters: more specific phrases checked first
DECISION_PATTERNS = [
    # Foul Play
    (r'\bred\s*card\b', 'Dangerous Play', 'Foul Play', 'Red Card'),
    (r'\byellow\s*card\b', 'Dangerous Play', 'Foul Play', 'Yellow Card'),
    (r'\bsin\s*bin\b', 'Dangerous Play', 'Foul Play', 'Yellow Card'),
    (r'\bbunker\b.*\b(red|card)\b', 'Dangerous Play', 'Foul Play', 'Red Card Review'),
    (r'\btmo\b.*\b(red|card|foul)\b', 'Dangerous Play', 'Foul Play', 'TMO Review'),
    (r'\bhigh\s*tackle\b', 'High Tackle', 'Foul Play', 'Penalty'),
    (r'\bneck\b.*\btackle\b', 'High Tackle', 'Foul Play', 'Penalty'),
    (r'\bhead\s*contact\b', 'High Tackle', 'Foul Play', 'Penalty'),
    (r'\bcontact\s*(with\s*(the\s*)?)?head\b', 'High Tackle', 'Foul Play', 'Penalty'),
    (r'\bshoulder\s*charge\b', 'Dangerous Play', 'Foul Play', 'Penalty'),
    (r'\bno\s*arms?\b.*\btackle\b', 'Dangerous Play', 'Foul Play', 'Penalty'),
    (r'\btip\s*tackle\b', 'Tip Tackle', 'Foul Play', 'Penalty'),
    (r'\blift(ed|ing)\b.*\btackle\b', 'Tip Tackle', 'Foul Play', 'Penalty'),
    (r'\bdangerous\s*(tackle|play)\b', 'Dangerous Play', 'Foul Play', 'Penalty'),
    (r'\bstamp(ed|ing)?\b', 'Stamping', 'Foul Play', 'Penalty'),
    (r'\boff\s*the\s*ball\b', 'Off the Ball', 'Foul Play', 'Penalty'),
    (r'\blate\s*(hit|tackle|charge)\b', 'Off the Ball', 'Foul Play', 'Penalty'),
    (r'\bpunch(ed|ing)?\b', 'Off the Ball', 'Foul Play', 'Penalty'),
    (r'\bstriking\b', 'Off the Ball', 'Foul Play', 'Penalty'),
    (r'\bfoul\s*play\b', 'Dangerous Play', 'Foul Play', 'Penalty'),

    # Penalty Try
    (r'\bpenalty\s*try\b', 'Penalty Try', 'Scoring', 'Penalty Try'),

    # Scoring
    (r'\btry\b.*\b(award|given|score)\b', 'Try', 'Scoring', 'Try'),
    (r'\b(award|given|score).*\btry\b', 'Try', 'Scoring', 'Try'),
    (r'\bno\s*try\b', 'No Try', 'Scoring', 'No Try'),
    (r'\bgrounding\b', 'Try', 'Scoring', 'TMO Review'),

    # Set Piece
    (r'\bscrum\b.*\bpenalty\b', 'Scrum Penalty', 'Set Piece', 'Penalty'),
    (r'\bpenalty\b.*\bscrum\b', 'Scrum Penalty', 'Set Piece', 'Penalty'),
    (r'\bcollaps(e|ed|ing)\b.*\bscrum\b', 'Scrum Penalty', 'Set Piece', 'Penalty'),
    (r'\bscrum\b.*\bcollaps(e|ed|ing)\b', 'Scrum Penalty', 'Set Piece', 'Penalty'),
    (r'\bnot\s*straight\b.*\b(lineout|throw)\b', 'Not Straight', 'Set Piece', 'Free Kick'),
    (r'\b(lineout|throw)\b.*\bnot\s*straight\b', 'Not Straight', 'Set Piece', 'Free Kick'),
    (r'\blineout\b.*\b(penalty|infring)\b', 'Lineout Offence', 'Set Piece', 'Penalty'),
    (r'\bcrooked\s*(feed|put)\b', 'Scrum Penalty', 'Set Piece', 'Free Kick'),
    (r'\bfree\s*kick\b', 'Scrum Penalty', 'Set Piece', 'Free Kick'),

    # Breakdown
    (r'\bnot\s*rolling\s*away\b', 'Not Rolling Away', 'Breakdown', 'Penalty'),
    (r'\broll(ed|ing)?\s*away\b', 'Not Rolling Away', 'Breakdown', 'Penalty'),
    (r'\bhands?\s*(in|on)\s*(the\s*)?ruck\b', 'Hands in the Ruck', 'Breakdown', 'Penalty'),
    (r'\bsealing\s*off\b', 'Sealing Off', 'Breakdown', 'Penalty'),
    (r'\bnot\s*releas(e|ed|ing)\b', 'Not Releasing', 'Breakdown', 'Penalty'),
    (r'\bhold(ing)?\s*(on|the\s*ball)\b', 'Not Releasing', 'Breakdown', 'Penalty'),
    (r'\boff\s*(his|her|their)\s*feet\b', 'Off Feet', 'Breakdown', 'Penalty'),
    (r'\b(off|on)\s*feet\b.*\b(ruck|breakdown)\b', 'Off Feet', 'Breakdown', 'Penalty'),
    (r'\bjackall?(ed|ing)?\b', 'Not Releasing', 'Breakdown', 'Turnover Penalty'),
    (r'\bturnover\b', 'Not Releasing', 'Breakdown', 'Turnover'),
    (r'\bbreakdown\b.*\bpenalty\b', 'Not Rolling Away', 'Breakdown', 'Penalty'),
    (r'\bpenalty\b.*\bbreakdown\b', 'Not Rolling Away', 'Breakdown', 'Penalty'),

    # General Play
    (r'\bknock[\s-]*on\b', 'Knock-On', 'General Play', 'Scrum'),
    (r'\bforward\s*pass\b', 'Forward Pass', 'General Play', 'Scrum'),
    (r'\boffside\b', 'Offside', 'General Play', 'Penalty'),
    (r'\bobstruction\b', 'Obstruction', 'General Play', 'Penalty'),
    (r'\baccidental\s*offside\b', 'Offside', 'General Play', 'Scrum'),
    (r'\bin\s*touch\b', 'Touch', 'General Play', 'Lineout'),
    (r'\bcollaps(e|ed|ing)\b.*\bmaul\b', 'Collapsing the Maul', 'General Play', 'Penalty'),
    (r'\bmaul\b.*\bcollaps(e|ed|ing)\b', 'Collapsing the Maul', 'General Play', 'Penalty'),

    # Advantage
    (r'\badvantage\b.*\b(play|signal|over)\b', 'Advantage Played', 'Advantage', 'Advantage'),
    (r'\b(play|signal)\b.*\badvantage\b', 'Advantage Played', 'Advantage', 'Advantage'),
    (r'\badvantage\b', 'Advantage Played', 'Advantage', 'Advantage'),

    # Generic penalty (fallback)
    (r'\bpenalty\b', 'Not Rolling Away', 'Breakdown', 'Penalty'),
]

# Aftermath context: words that indicate what happened after the decision
AFTERMATH_PATTERNS = [
    (r'\bred\s*card\b', 'Red Card'),
    (r'\byellow\s*card\b', 'Yellow Card'),
    (r'\bsin\s*bin\b', 'Yellow Card'),
    (r'\bwarning\b', 'Warning'),
    (r'\bpenalty\s*try\b', 'Penalty Try + Yellow Card'),
    (r'\bpenalty\b.*\b(kick|goal|corner|touch)\b', 'Penalty Kick'),
    (r'\btmo\b', 'TMO Review'),
    (r'\bbunker\b', 'TMO Review'),
    (r'\breview\b', 'TMO Review'),
    (r'\bscrum\b', 'Scrum'),
    (r'\bfree\s*kick\b', 'Free Kick'),
    (r'\blineout\b', 'Lineout'),
    (r'\bpenalty\b', 'Penalty'),
]


def download_captions(url, output_dir):
    """Download YouTube auto-generated English captions in json3 format."""
    print(f"Downloading captions from: {url}")
    cmd = [
        sys.executable, '-m', 'yt_dlp',
        '--write-auto-sub',
        '--sub-lang', 'en',
        '--sub-format', 'json3',
        '--skip-download',
        '-o', os.path.join(output_dir, '%(id)s'),
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Warning: yt-dlp stderr: {result.stderr[:500]}")

    # Find the json3 file
    for f in os.listdir(output_dir):
        if f.endswith('.json3'):
            path = os.path.join(output_dir, f)
            print(f"Captions saved to: {path}")
            return path

    raise RuntimeError(
        f"Failed to download captions. yt-dlp output:\n{result.stdout}\n{result.stderr}"
    )


def parse_captions(json3_path):
    """Parse json3 captions into a list of (start_ms, end_ms, text) tuples."""
    with open(json3_path, 'r') as f:
        data = json.load(f)

    segments = []
    for event in data.get('events', []):
        start_ms = event.get('tStartMs', 0)
        duration_ms = event.get('dDurationMs', 0)
        segs = event.get('segs', [])
        if not segs:
            continue

        text = ''.join(seg.get('utf8', '') for seg in segs).strip()
        if not text or text == '\n':
            continue

        segments.append({
            'start_ms': start_ms,
            'end_ms': start_ms + duration_ms,
            'text': text,
        })

    print(f"  Parsed {len(segments)} caption segments")
    return segments


def get_text_around_time(segments, time_sec, window_before=5, window_after=30):
    """Extract all caption text within a time window around a given timestamp."""
    target_ms = int(time_sec * 1000)
    start_ms = target_ms - (window_before * 1000)
    end_ms = target_ms + (window_after * 1000)

    texts = []
    for seg in segments:
        if seg['end_ms'] >= start_ms and seg['start_ms'] <= end_ms:
            texts.append(seg['text'])

    return ' '.join(texts).lower()


def match_decision(text):
    """Match commentary text against decision patterns. Returns best match."""
    for pattern, decision, category, ref_call in DECISION_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return {
                'correctDecision': decision,
                'category': category,
                'refActualCall': ref_call,
                'matched_pattern': pattern,
            }
    return None


def match_aftermath(text):
    """Look for aftermath indicators (card color, review, etc.)."""
    results = []
    for pattern, label in AFTERMATH_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            results.append(label)
    return results


def extract_context_quote(segments, time_sec, window_after=20):
    """Extract a short relevant quote from commentary around the decision."""
    target_ms = int(time_sec * 1000)
    end_ms = target_ms + (window_after * 1000)

    texts = []
    for seg in segments:
        if seg['start_ms'] >= target_ms and seg['start_ms'] <= end_ms:
            texts.append(seg['text'])

    full = ' '.join(texts).strip()
    # Clean up
    full = re.sub(r'\s+', ' ', full)
    # Truncate to ~150 chars at word boundary
    if len(full) > 150:
        full = full[:150].rsplit(' ', 1)[0] + '...'
    return full


def process_whistles(segments, whistle_times, video_id, video_url):
    """Process each whistle timestamp and enrich with caption data."""
    enriched = []

    for i, wt in enumerate(whistle_times):
        time_sec = wt if isinstance(wt, (int, float)) else wt.get('whistleTime', 0)
        confidence = wt.get('_confidence', 0) if isinstance(wt, dict) else 0

        mins = int(time_sec // 60)
        secs = int(time_sec % 60)
        print(f"\n  Analyzing {mins}:{secs:02d} (confidence: {confidence:.2f})...")

        # Get commentary text: 5s before whistle to 30s after
        text_full = get_text_around_time(segments, time_sec, window_before=5, window_after=30)
        # Also get just the aftermath (from whistle onward)
        text_after = get_text_around_time(segments, time_sec, window_before=0, window_after=30)

        # Try to match a decision
        decision = match_decision(text_full)
        aftermath = match_aftermath(text_after)
        quote = extract_context_quote(segments, time_sec, window_after=25)

        if decision:
            print(f"    Decision: {decision['correctDecision']} ({decision['category']})")
            print(f"    Ref call: {decision['refActualCall']}")
            if aftermath:
                print(f"    Aftermath: {', '.join(aftermath)}")
                # Update ref call with more specific aftermath info
                decision['refActualCall'] = aftermath[0]
        else:
            print(f"    No clear decision detected in commentary")
            decision = {
                'correctDecision': 'TODO',
                'category': 'TODO',
                'refActualCall': 'TODO',
                'matched_pattern': None,
            }

        if quote:
            print(f"    Commentary: \"{quote[:80]}...\"" if len(quote) > 80 else f"    Commentary: \"{quote}\"")

        buildup_start = max(0, time_sec - 25)
        aftermath_end = time_sec + 15

        clip = {
            'id': f'fg_{i+1:03d}',
            'videoId': video_id,
            'title': f'TODO — {mins}:{secs:02d}',
            'mode': 'fullgame',
            'buildUpStart': int(buildup_start),
            'whistleTime': int(time_sec),
            'aftermathEnd': int(aftermath_end),
            'correctDecision': decision['correctDecision'],
            'category': decision['category'],
            'difficulty': 'medium',
            'explanation': f'Commentary: "{quote}"' if quote else 'TODO — watch the clip and describe the incident',
            'refActualCall': decision['refActualCall'],
            'level': 'International',
            'tags': ['men', 'test-match'],
            '_confidence': round(confidence, 2),
            '_commentary': quote,
            '_matched_pattern': decision.get('matched_pattern'),
            '_aftermath_indicators': aftermath if aftermath else [],
        }

        enriched.append(clip)

    return enriched


def extract_video_id(url):
    """Extract YouTube video ID from URL."""
    patterns = [
        r'(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([a-zA-Z0-9_-]{11})',
        r'^([a-zA-Z0-9_-]{11})$',
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m[1]
    return None


def main():
    parser = argparse.ArgumentParser(
        description='Extract referee decisions from YouTube commentary captions'
    )
    parser.add_argument('--url', required=True, help='YouTube video URL')
    parser.add_argument('--whistles', help='Path to whistles.json from detect_whistles.py')
    parser.add_argument('--times', help='Comma-separated whistle timestamps in seconds')
    parser.add_argument('--output', default='enriched_clips.json', help='Output JSON file')
    parser.add_argument('--min-confidence', type=float, default=0.0,
                        help='Minimum confidence to include (when using --whistles)')
    parser.add_argument('--top', type=int, default=0,
                        help='Only process top N highest-confidence whistles')
    parser.add_argument('--window-after', type=int, default=30,
                        help='Seconds of commentary to analyze after whistle (default: 30)')
    parser.add_argument('--captions-file', help='Use pre-downloaded json3 captions file')
    parser.add_argument('--keep-captions', action='store_true',
                        help='Keep downloaded caption files')

    args = parser.parse_args()

    video_id = extract_video_id(args.url)
    if not video_id:
        print(f"Error: Could not extract video ID from: {args.url}")
        sys.exit(1)

    # Get whistle timestamps
    whistle_times = []
    if args.whistles:
        with open(args.whistles) as f:
            data = json.load(f)
        # Filter by confidence
        if args.min_confidence > 0:
            data = [d for d in data if d.get('_confidence', 0) >= args.min_confidence]
        # Sort by confidence descending
        data.sort(key=lambda x: -x.get('_confidence', 0))
        # Take top N
        if args.top > 0:
            data = data[:args.top]
        # Sort back by time
        data.sort(key=lambda x: x.get('whistleTime', 0))
        whistle_times = data
        print(f"Loaded {len(whistle_times)} whistle timestamps")
    elif args.times:
        whistle_times = [float(t.strip()) for t in args.times.split(',')]
        print(f"Using {len(whistle_times)} manual timestamps")
    else:
        print("Error: Provide either --whistles or --times")
        sys.exit(1)

    if not whistle_times:
        print("No whistle timestamps to analyze")
        sys.exit(1)

    # Download or load captions
    if args.captions_file:
        json3_path = args.captions_file
        tmp_dir = None
    else:
        tmp_dir = tempfile.mkdtemp()
        json3_path = download_captions(args.url, tmp_dir)

    # Parse captions
    print(f"\nParsing captions...")
    segments = parse_captions(json3_path)

    # Process each whistle
    print(f"\nAnalyzing {len(whistle_times)} whistle moments...")
    enriched = process_whistles(segments, whistle_times, video_id, args.url)

    # Summary
    detected = sum(1 for c in enriched if c['correctDecision'] != 'TODO')
    print(f"\n{'='*50}")
    print(f"Results: {detected}/{len(enriched)} decisions detected from commentary")
    print(f"{'='*50}")

    # Category breakdown
    categories = {}
    for c in enriched:
        cat = c['correctDecision']
        categories[cat] = categories.get(cat, 0) + 1
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

    # Write output
    with open(args.output, 'w') as f:
        json.dump(enriched, f, indent=2)
    print(f"\nOutput written to: {args.output}")

    # Cleanup
    if tmp_dir and not args.keep_captions:
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)
    elif tmp_dir:
        print(f"Captions kept at: {json3_path}")


if __name__ == '__main__':
    main()
