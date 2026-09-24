"""Run the unmodified upstream Agent loop with a local fixture CDP transport.

No network client is installed or used. Only daemon/transport and inference are
replaced; Agent, Browser, snapshots, action-space building, response validation,
target validation, input execution, and settling execute upstream source.
"""
import importlib
import json
import sys
import time
import types


def request(kind, **payload):
    print(json.dumps({"kind": kind, **payload}), flush=True)
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError("Benchmark parent disconnected")
    response = json.loads(line)
    if "error" in response:
        raise RuntimeError(response["error"])
    return response.get("value")


def cdp(method, session_id=None, **params):
    return request("cdp", method=method, params=params)


config = json.loads(sys.stdin.readline())
sys.path.insert(0, config["upstream"])
# The real browser-harness daemon is replaced by the benchmark's one-page CDP
# transport, so the benchmark cannot attach to the user's browsing profile.
harness = types.ModuleType("browser_harness")
admin = types.ModuleType("browser_harness.admin")
admin.ensure_daemon = lambda: None
helpers = types.ModuleType("browser_harness.helpers")
helpers.cdp = cdp
sys.modules.update({"browser_harness": harness, "browser_harness.admin": admin,
                    "browser_harness.helpers": helpers})
# Ensure an accidental new network call fails rather than using credentials.
httpx = types.ModuleType("httpx")
class NoNetworkClient:
    def __init__(self, **kwargs):
        pass
    def post(self, *args, **kwargs):
        raise RuntimeError("Network inference is disabled in the fixture benchmark")
httpx.Client = NoNetworkClient
httpx.HTTPError = RuntimeError
sys.modules["httpx"] = httpx
model = importlib.import_module("jev_ultrafast.model")
model.post_json = lambda url, key, body: request("infer", body=body)
# Upstream indexes this environment name before calling post_json; use an
# explicit fake marker and never read or forward an actual credential.
model.os.environ["TYPESAFE_API_KEY"] = "offline-benchmark-no-credential"
model.field_text = lambda context: (request("field", context=context),
                                   {"model": "deterministic-fixture", "latency_ms": 0, "usage": {}})
agent_module = importlib.import_module("jev_ultrafast.agent")
agent_module.field_text = model.field_text
with agent_module.Agent(config["url"], config["goal"], screenshots=False) as agent:
    request("loop-start")
    start = time.perf_counter()
    failure = None
    try:
        for _ in agent.run():
            pass
    except Exception as error:
        failure = str(error)
    state = agent.snapshot()
    result = {"status": "error" if failure else state["status"], "error": failure, "steps": len(state["history"]),
              "modelCalls": len(state["decisions"]), "textCalls": len(state["text_calls"]),
              "elapsedMs": (time.perf_counter()-start)*1000,
              "operations": [entry["operation"] for entry in state["history"]]}
print(json.dumps({"kind": "result", "value": result}), flush=True)
