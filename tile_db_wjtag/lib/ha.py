import requests


class HomeAssistantClient:
    def __init__(self, base_url: str, token: str, timeout: int = 10):
        """
        :param base_url: e.g. http://192.168.0.200:8123
        :param token: Long-lived access token
        """
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        })
        self.timeout = timeout

    # ----------------------------
    # GET STATE
    # ----------------------------
    def get_state(self, entity_id: str):
        """Return full state dict of one entity."""
        r = self.session.get(
            f"{self.base_url}/api/states/{entity_id}",
            timeout=self.timeout
        )
        r.raise_for_status()
        return r.json()

    def get_state_value(self, entity_id: str):
        """Return only the state value."""
        return self.get_state(entity_id)["state"]

    def get_all_states(self):
        """Return all entities."""
        r = self.session.get(
            f"{self.base_url}/api/states",
            timeout=self.timeout
        )
        r.raise_for_status()
        return r.json()

    # ----------------------------
    # CALL SERVICE (recommended)
    # ----------------------------
    def call_service(self, domain: str, service: str, data: dict):
        """
        Example:
            call_service("light", "turn_on", {"entity_id": "light.kitchen"})
        """
        r = self.session.post(
            f"{self.base_url}/api/services/{domain}/{service}",
            json=data,
            timeout=self.timeout
        )
        r.raise_for_status()
        return r.json()

    # ----------------------------
    # SET STATE (developer use)
    # ----------------------------
    def set_state(self, entity_id: str, state: str, attributes: dict = None):
        """
        WARNING:
        This only sets the state in HA state machine.
        It does NOT control physical devices.
        """
        payload = {
            "state": state,
            "attributes": attributes or {}
        }

        r = self.session.post(
            f"{self.base_url}/api/states/{entity_id}",
            json=payload,
            timeout=self.timeout
        )
        r.raise_for_status()
        return r.json()
