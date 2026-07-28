#!/bin/bash
set -e

echo "Deploying DingerLab update..."

# This script lives inside the extracted update directory.
# It copies the updated files into the parent project directory.

TARGET="${1:-..}"

echo "Copying updated files to $TARGET"
cp dingerlab_server.py "$TARGET/"
cp index.html "$TARGET/"
cp "DingerLab Redesign.dc.html" "$TARGET/"
cp README.md "$TARGET/"
cp requirements.txt "$TARGET/"
cp soccer.js "$TARGET/"
cp support.js "$TARGET/"

echo "Done. Updated files deployed to $TARGET"
echo "Restart the server with: python dingerlab_server.py"
