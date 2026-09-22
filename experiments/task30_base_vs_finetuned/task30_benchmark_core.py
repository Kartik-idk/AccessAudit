import json
import urllib.request
import urllib.error

SYSTEM_PROMPT = "You are an expert accessibility engineer. You MUST reply with ONLY a flat JSON object. Do NOT output any conversational text."

def build_ollama_request(model_name, user_prompt, options):
    return {
        "model": model_name,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": user_prompt }
        ],
        "stream": False,
        "options": options
    }

def call_ollama(request_data):
    req = urllib.request.Request(
        "http://localhost:11434/api/chat",
        data=json.dumps(request_data).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.URLError as e:
        return {"error": str(e)}

