#!/usr/bin/env python3
"""Deploy script for DingerLab updates.

Run this from the extracted update directory:
    python deploy.py
"""
import argparse
import shutil
from pathlib import Path


def deploy(target: Path):
    target = target.resolve()
    target.mkdir(parents=True, exist_ok=True)

    files_to_copy = [
        "dingerlab_server.py",
        "index.html",
        "DingerLab Redesign.dc.html",
        "README.md",
        "requirements.txt",
        "soccer.js",
        "support.js",
    ]
    for f in files_to_copy:
        src = Path(f)
        if src.exists():
            shutil.copy2(src, target / src.name)
            print(f"Copied {f}")
        else:
            print(f"Warning: {f} not found")

    print(f"Done. Updated files deployed to {target}")
    print("Restart the server with: python dingerlab_server.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default="..", help="Target directory (default: parent)")
    args = parser.parse_args()
    deploy(Path(args.target))
