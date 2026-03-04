import requests

# Configuration
HA_URL = "http://192.168.0.200:8123"
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiI4YjEyZWE1Yzc4NTE0Y2FmODRlNWQzYWQwMmIzZTNjNyIsImlhdCI6MTc3MTIxODg3MCwiZXhwIjoyMDg2NTc4ODcwfQ.7BnKN_KS1Pa5SuKWXXDv2xoZtkSH05ttgAq3OSzCQdk"

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "content-type": "application/json",
}

response = requests.get(
    f"{HA_URL}/api/states",
    headers=headers,
)

if response.status_code == 200:
    entities = response.json()
    
    # Filter only sensors
    sensors = [e for e in entities if e["entity_id"].startswith("sensor.")]

    for sensor in sensors:
        print(sensor["entity_id"], "=", sensor["state"])



# Get one specific sensor
entity_id = "switch.piro_atlas_prog_station_ps_db1a"

response = requests.get(
    f"{HA_URL}/api/states/{entity_id}",
    headers=headers,
)

if response.status_code == 200:
    data = response.json()
    print("State:", data["state"])
    print("Attributes:", data["attributes"])
else:
    print("Error:", response.status_code, response.text)

