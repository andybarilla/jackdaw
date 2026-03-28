#!/bin/sh
set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 0.2.0"
    exit 1
fi

VERSION="$1"
TAG="v$VERSION"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Validate semver-ish format
echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+' || {
    echo "Error: version must be semver (e.g., 0.2.0)"
    exit 1
}

# Check for clean working tree
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
    echo "Error: working tree is not clean. Commit or stash changes first."
    exit 1
fi

# Check tag doesn't already exist
if git -C "$ROOT" rev-parse "$TAG" >/dev/null 2>&1; then
    echo "Error: tag $TAG already exists"
    exit 1
fi

echo "Bumping version to $VERSION..."

# Update package.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$ROOT/package.json"

# Update tauri.conf.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$ROOT/src-tauri/tauri.conf.json"

# Update Cargo.toml (only the package version, not dependency versions)
sed -i "0,/^version = \"[^\"]*\"/s//version = \"$VERSION\"/" "$ROOT/src-tauri/Cargo.toml"

# Update Cargo.lock
(cd "$ROOT/src-tauri" && cargo generate-lockfile 2>/dev/null || true)

echo "Updated:"
echo "  package.json"
echo "  src-tauri/tauri.conf.json"
echo "  src-tauri/Cargo.toml"

# Commit and tag
git -C "$ROOT" add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git -C "$ROOT" commit -m "chore: bump version to $VERSION"
git -C "$ROOT" tag "$TAG"

echo ""
echo "Created commit and tag $TAG"
echo "Run 'git push && git push --tags' to publish"
