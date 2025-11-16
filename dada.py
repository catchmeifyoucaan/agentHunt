import os, requests

API = "https://inference.do-ai.run/v1/chat/completions"
KEY = os.environ["MODEL_ACCESS_KEY"]
headers = {
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
}
payload = {
  "model": "deepseek-r1-distill-llama-70b",
  "messages": [
    {"role": "system", "content": "You are BugHunty Assistant..."},
    {"role": "user", "content": "Describe safe exploitation steps for stored XSS..."}
  ],
  "temperature": 0.2,
  "max_tokens": 350
}
r = requests.post(API, headers=headers, json=payload)
print(r.json())
