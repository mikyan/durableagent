"""Validate a release tag and verify the signed APK before it can be published."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def version(tag):
    values = dict(line.split("=", 1) for line in
                  (ROOT / "android/version.properties").read_text().splitlines()
                  if line and not line.startswith("#"))
    name = values["VERSION_NAME"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", name) or tag != "v" + name:
        raise ValueError("Tag must exactly match android/version.properties")
    code = int(values["VERSION_CODE"])
    if not 0 < code <= 2100000000 or values["RELEASE_CHANNEL"] not in ("prerelease", "stable"):
        raise ValueError("Invalid release version or channel")
    notes = ROOT / "docs/releases" / (tag + ".md")
    if not notes.is_file():
        raise ValueError("Every release requires committed release notes")
    return {"tag": tag, "versionName": name, "versionCode": code,
            "prerelease": values["RELEASE_CHANNEL"] == "prerelease"}


def run(*args):
    return subprocess.check_output(args, text=True, encoding="utf-8", errors="replace")


def package(args):
    metadata = version(args.tag)
    if not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        raise ValueError("Expected full source commit")
    apk = Path(args.apk)
    signature = run(args.apksigner, "verify", "--verbose", "--print-certs", str(apk))
    signers = re.findall(r"Signer #[0-9]+ certificate SHA-256 digest: ([0-9a-fA-F]{64})", signature)
    expected = (ROOT / "android/release-signing-certificate.sha256").read_text().strip().lower()
    if len(signers) != 1 or signers[0].lower() != expected:
        raise ValueError("APK does not have the pinned release signing certificate")
    badging = run(args.aapt, "dump", "badging", str(apk))
    package_info = re.search(r"package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'", badging)
    if not package_info or package_info.groups() != ("dev.durableagent.probe", str(metadata["versionCode"]), metadata["versionName"]):
        raise ValueError("APK package/version does not match this release")
    if "application-debuggable" in badging:
        raise ValueError("Release APK must not be debuggable")
    if "sdkVersion:'36'" not in badging or "targetSdkVersion:'36'" not in badging:
        raise ValueError("Unexpected minimum or target Android API")
    native = re.search(r"^native-code:(.*)$", badging, re.MULTILINE)
    abis = sorted(re.findall(r"'([^']+)'", native.group(1))) if native else []
    if abis != ["arm64-v8a", "x86_64"]:
        raise ValueError("Unexpected APK native architectures")
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    target = output / f"durableagent-{args.tag}.apk"
    if apk.resolve() != target.resolve():
        shutil.copyfile(apk, target)
    metadata.update({"applicationId": package_info[1], "minSdk": 36, "targetSdk": 36,
                     "debuggable": False, "abis": abis, "sourceCommit": args.commit,
                     "buildUrl": args.build_url, "signingCertificateSha256": expected,
                     "apk": target.name, "apkSha256": hashlib.sha256(target.read_bytes()).hexdigest()})
    (output / "release-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    names = (target.name, "release-metadata.json")
    (output / "SHA256SUMS.txt").write_text("".join(
        f"{hashlib.sha256((output / name).read_bytes()).hexdigest()}  {name}\n" for name in names), encoding="ascii")
    print(json.dumps(metadata, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate")
    validate.add_argument("--tag", required=True)
    validate.add_argument("--github-output")
    build = sub.add_parser("package")
    for name in ("tag", "apk", "apksigner", "aapt", "commit", "output"):
        build.add_argument("--" + name, required=True)
    build.add_argument("--build-url", default="local-validation")
    args = parser.parse_args()
    if args.command == "package":
        package(args)
    else:
        info = version(args.tag)
        if args.github_output:
            with open(args.github_output, "a", encoding="utf-8") as stream:
                stream.write(f"tag={info['tag']}\nprerelease={str(info['prerelease']).lower()}\n")
        print(json.dumps(info))


if __name__ == "__main__":
    main()
