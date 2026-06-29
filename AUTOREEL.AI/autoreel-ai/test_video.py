import requests
import json

payload = {
    "topic": "History of Rome",
    "audio_path": "backend/storage/audio/voice_1773570700.wav",
    "subtitle_path": "backend/storage/subtitles/trans_1773570709.srt",
    "template": "motivation",
    "category": "storytelling",
    "caption_style": "tiktok",
    "script": "The Romans built an empire. It lasted a thousand years.",
    "layout": "split"
}

try:
    print("Requesting video generation...")
    r = requests.post("http://127.0.0.1:8014/generate-video", json=payload)
    print(json.dumps(r.json(), indent=2))
except Exception as e:
    print(e)
