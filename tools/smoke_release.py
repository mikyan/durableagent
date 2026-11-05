"""Smoke the exact release APK on a fresh API 36 emulator, without debug APIs.

The caller creates the isolated AVD. This script never wipes an AVD, uninstalls an
app, supplies model credentials, or submits a conversation input. A refusal to
overwrite an existing package is deliberate, even on an emulator.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET

PACKAGE = "dev.durableagent.probe"
HOME_TITLE = "从一个问题开始"
CREATE_LABEL = "新建会话"
MISSING_MODEL = "请先配置新会话默认模型"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_bounds(value: str) -> tuple[int, int, int, int] | None:
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", value)
    if not match:
        return None
    left, top, right, bottom = map(int, match.groups())
    return (left, top, right, bottom) if right > left and bottom > top else None


def visible_labels(root: ET.Element) -> list[str]:
    return [node.get(field, "") for node in root.iter("node")
            if node.get("visible-to-user", "true") == "true"
            for field in ("text", "content-desc") if node.get(field)]


def create_button(root: ET.Element) -> tuple[int, int, int, int] | None:
    parents = {child: parent for parent in root.iter() for child in parent}
    for node in root.iter("node"):
        if CREATE_LABEL not in (node.get("text"), node.get("content-desc")):
            continue
        current: ET.Element | None = node
        while current is not None:
            if current.get("enabled") == "false" or current.get("visible-to-user") == "false":
                break
            if current.get("clickable") == "true" and current.get("enabled") == "true":
                bounds = parse_bounds(current.get("bounds", ""))
                if bounds:
                    return bounds
            current = parents.get(current)
    return None


def package_facts(text: str) -> dict:
    versions = re.search(r"\bversionCode=(\d+).*?\bminSdk=(\d+).*?\btargetSdk=(\d+)", text)
    flags = re.findall(r"\b(?:flags|pkgFlags)=\[([^]]*)\]", text)
    if not versions or not flags:
        raise RuntimeError("Package version or flags could not be verified")
    words = set(" ".join(flags).split())
    return {
        "versionCode": int(versions[1]), "minSdk": int(versions[2]),
        "targetSdk": int(versions[3]), "debuggable": "DEBUGGABLE" in words,
        "testOnly": "TEST_ONLY" in words,
    }


def adb_executable() -> str:
    if os.environ.get("ADB"):
        return os.environ["ADB"]
    found = shutil.which("adb")
    if found:
        return found
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if sdk:
        candidate = Path(sdk) / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb")
        if candidate.is_file():
            return str(candidate)
    raise RuntimeError("adb is required on PATH or through ADB/ANDROID_HOME")


class Device:
    def __init__(self, serial: str):
        self.prefix = [adb_executable(), "-s", serial]

    def run(self, *args: str, timeout: float = 20) -> bytes:
        result = subprocess.run([*self.prefix, *args], capture_output=True, timeout=timeout)
        if result.returncode:
            detail = (result.stderr or result.stdout).decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"adb {args[0]} failed ({result.returncode}): {detail[:1000]}")
        return result.stdout

    def text(self, *args: str, timeout: float = 20) -> str:
        return self.run(*args, timeout=timeout).decode("utf-8", errors="replace").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--serial", default="emulator-5554")
    args = parser.parse_args()
    if not re.fullmatch(r"emulator-\d+", args.serial):
        parser.error("Only an explicitly selected emulator serial is supported")
    apk = args.apk.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with (output / "started.json").open("x", encoding="utf-8") as marker:
        json.dump({"startedAt": now(), "serial": args.serial, "apk": apk.name}, marker)
    with apk.open("rb") as source:
        apk_digest = hashlib.file_digest(source, "sha256").hexdigest()
    result = {
        "schemaVersion": 1, "startedAt": now(), "serial": args.serial,
        "scope": "Fresh emulator, exact signed nondebug APK, normal launcher and product UI; no LLM, Termux, ARM64 or OEM acceptance.",
        "apkSha256": apk_digest,
        "passed": False, "installedByThisRun": False, "artifacts": [],
    }
    device: Device | None = None
    hierarchy_path = "/sdcard/durableagent-release-smoke-" + uuid.uuid4().hex + ".xml"
    failure: Exception | None = None

    def save(name: str, data: bytes) -> None:
        (output / name).write_bytes(data)
        if name not in result["artifacts"]:
            result["artifacts"].append(name)

    def hierarchy(name: str, timeout: float = 20) -> ET.Element:
        assert device is not None
        end = time.monotonic() + timeout
        device.run("shell", "uiautomator", "dump", "--compressed", hierarchy_path, timeout=min(15, timeout))
        remaining = end - time.monotonic()
        if remaining <= 0:
            raise RuntimeError("UI hierarchy observation exceeded its deadline")
        data = device.run("exec-out", "cat", hierarchy_path, timeout=min(5, remaining))
        root = ET.fromstring(data)
        save(name, data)
        return root

    def wait_for_home() -> tuple[int, int, int, int]:
        deadline = time.monotonic() + 90
        previous = None
        last_error = "Home has not been rendered"
        while time.monotonic() < deadline:
            try:
                root = hierarchy("latest-ui.xml", min(20, deadline - time.monotonic()))
                bounds = create_button(root) if HOME_TITLE in visible_labels(root) else None
                if bounds and bounds == previous:
                    save("home-ui.xml", (output / "latest-ui.xml").read_bytes())
                    return bounds
                previous = bounds
            except (RuntimeError, ET.ParseError, subprocess.TimeoutExpired) as error:
                last_error = str(error)
                previous = None
            time.sleep(min(0.5, max(0, deadline - time.monotonic())))
        raise RuntimeError("Product home and enabled create button did not stabilize within 90s: " + last_error)

    try:
        device = Device(args.serial)
        if device.text("get-state") != "device":
            raise RuntimeError("Selected emulator is not online")
        emulator = device.text("shell", "getprop", "ro.kernel.qemu")
        if emulator != "1":
            emulator = device.text("shell", "getprop", "ro.boot.qemu")
        if emulator != "1":
            raise RuntimeError("Selected device does not identify as an emulator")
        if device.text("shell", "am", "get-current-user") != "0":
            raise RuntimeError("This smoke test requires a fresh emulator primary user")
        sdk = device.text("shell", "getprop", "ro.build.version.sdk")
        if sdk != "36":
            raise RuntimeError("This smoke test requires an API 36 emulator")
        known = device.text("shell", "cmd", "package", "list", "packages", "-u", PACKAGE)
        if f"package:{PACKAGE}" in known.splitlines():
            raise RuntimeError("Refusing to overwrite an existing or retained app; use a fresh isolated AVD")
        result["environment"] = {
            "api": int(sdk), "abi": device.text("shell", "getprop", "ro.product.cpu.abi"),
            "pageSize": int(device.text("shell", "getconf", "PAGE_SIZE")),
            "packagePreviouslyPresent": False, "emulator": True,
        }
        save("install.log", device.run("install", "--no-streaming", str(apk), timeout=120))
        result["installedByThisRun"] = True
        uid_text = device.text("shell", "cmd", "package", "list", "packages", "-U", PACKAGE)
        uid_match = re.search(r"^package:" + re.escape(PACKAGE) + r" uid:(\d+)\s*$", uid_text, re.M)
        if not uid_match:
            raise RuntimeError("Cannot identify the exact app UID for scoped logs")
        result["appUid"] = int(uid_match[1])
        facts = package_facts(device.text("shell", "dumpsys", "package", PACKAGE))
        result["package"] = facts
        if facts["debuggable"] or facts["testOnly"] or facts["minSdk"] != 36 or facts["targetSdk"] != 36:
            raise RuntimeError("Installed package is not the expected API 36 nondebug release")
        save("launch.log", device.run("shell", "am", "start", "-W", "-n", PACKAGE + "/.AgentActivity", timeout=30))
        bounds = wait_for_home()
        result["homeReady"] = True
        save("home.png", device.run("exec-out", "screencap", "-p"))
        size_matches = re.findall(r"(\d+)x(\d+)", device.text("shell", "wm", "size"))
        if not size_matches:
            raise RuntimeError("Cannot verify the display bounds before the single UI tap")
        width, height = map(int, size_matches[-1])
        left, top, right, bottom = bounds
        if not (0 <= left < right <= width and 0 <= top < bottom <= height):
            raise RuntimeError("Create button is outside the current display")
        device.run("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
        result["createButtonTappedOnce"] = True
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                root = hierarchy("latest-ui.xml", min(20, deadline - time.monotonic()))
                if any(MISSING_MODEL in label for label in visible_labels(root)):
                    save("product-model-required-ui.xml", (output / "latest-ui.xml").read_bytes())
                    result["productModelRequiredVisible"] = True
                    break
            except (RuntimeError, ET.ParseError, subprocess.TimeoutExpired):
                pass  # Only retry observation; the single UI action is never repeated.
            time.sleep(min(0.5, max(0, deadline - time.monotonic())))
        else:
            raise RuntimeError("Fresh product did not display the required default-model configuration message")
        result["passed"] = True
    except Exception as error:
        failure = error
        result["error"] = f"{type(error).__name__}: {error}"
    finally:
        if device is not None and result["installedByThisRun"]:
            for name, action in (
                ("final.png", lambda: device.run("exec-out", "screencap", "-p")),
                ("app-uid.log", lambda: device.run("logcat", "-d", "--uid=" + str(result["appUid"]), "-v", "threadtime")),
            ):
                try:
                    data = action()
                    save(name, data)
                    if name == "app-uid.log":
                        fatal = bool(re.search(rb"FATAL EXCEPTION|Fatal signal \d+|JNI DETECTED ERROR|ANR in " + re.escape(PACKAGE.encode()), data))
                        result["appUidFatalObserved"] = fatal
                        if fatal:
                            result["passed"] = False
                            result.setdefault("error", "Fatal event observed in the app UID log")
                except Exception as artifact_error:
                    result.setdefault("artifactErrors", []).append(f"{name}: {type(artifact_error).__name__}: {artifact_error}")
                    result["passed"] = False
                    result.setdefault("error", "Required smoke artifact could not be captured: " + name)
            # This is only the one temporary hierarchy file owned by this run.
            try:
                device.run("shell", "rm", "-f", hierarchy_path)
            except Exception as cleanup_error:
                result["hierarchyCleanupError"] = str(cleanup_error)
        result["completedAt"] = now()
        (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "result": str(output / "result.json"), "error": result.get("error")}, ensure_ascii=False))
    return 0 if result["passed"] and failure is None else 1


if __name__ == "__main__":
    sys.exit(main())
