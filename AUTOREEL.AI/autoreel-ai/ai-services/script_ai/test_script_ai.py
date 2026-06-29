import requests

try:
    response = requests.post(
        "http://localhost:8005/generate-script",
        json={"topic": "gym motivation"}
    )
    print("Status Code:", response.status_code)
    print("Response JSON:", response.json())
except Exception as e:
    print("Error:", e)
