#!/bin/sh
set -e

REPO="andybarilla/jackdaw"
INSTALL_DIR="${JACKDAW_INSTALL_DIR:-$HOME/.local/bin}"

install_from_deb() {
    deb_url="$1"
    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT

    deb_file="$tmpdir/jackdaw.deb"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$deb_url" -o "$deb_file"
    else
        wget -qO "$deb_file" "$deb_url"
    fi

    # Extract binary from deb without installing system-wide
    cd "$tmpdir"
    ar x "$deb_file"
    tar xf data.tar.* ./usr/bin/jackdaw 2>/dev/null || tar xf data.tar.* usr/bin/jackdaw

    src="$tmpdir/usr/bin/jackdaw"
    if [ ! -f "$src" ]; then
        echo "Error: could not extract jackdaw binary from deb"
        exit 1
    fi

    chmod +x "$src"
    rm -f "$INSTALL_DIR/jackdaw"
    mv "$src" "$INSTALL_DIR/jackdaw"
    trap - EXIT
    rm -rf "$tmpdir"
}

main() {
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m)

    case "$arch" in
        x86_64|amd64) ;;
        arm64|aarch64) ;;
        *) echo "Unsupported architecture: $arch"; exit 1 ;;
    esac

    # Get latest release tag
    if command -v curl >/dev/null 2>&1; then
        tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
    elif command -v wget >/dev/null 2>&1; then
        tag=$(wget -qO- "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
    else
        echo "Error: curl or wget required"
        exit 1
    fi

    if [ -z "$tag" ]; then
        echo "Error: could not determine latest release"
        exit 1
    fi

    # Determine artifact name from release assets
    if command -v curl >/dev/null 2>&1; then
        assets=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"name"' | cut -d'"' -f4)
    else
        assets=$(wget -qO- "https://api.github.com/repos/$REPO/releases/latest" | grep '"name"' | cut -d'"' -f4)
    fi

    case "$os" in
        linux)  artifact=$(echo "$assets" | grep -i '\.deb$' | head -1) ;;
        darwin) artifact=$(echo "$assets" | grep -i '\.dmg$' | head -1) ;;
        *)      echo "Unsupported OS: $os"; exit 1 ;;
    esac

    if [ -z "$artifact" ]; then
        echo "Error: no artifact found for $os/$arch"
        exit 1
    fi

    url="https://github.com/$REPO/releases/download/$tag/$artifact"

    echo "Installing Jackdaw $tag for $os/$arch..."
    mkdir -p "$INSTALL_DIR"

    case "$os" in
        linux)
            install_from_deb "$url"
            ;;
        *)
            # Download to temp file and move into place to avoid ETXTBSY when
            # overwriting a running binary
            tmpfile=$(mktemp "$INSTALL_DIR/jackdaw.XXXXXX")
            trap 'rm -f "$tmpfile"' EXIT

            if command -v curl >/dev/null 2>&1; then
                curl -fsSL "$url" -o "$tmpfile"
            else
                wget -qO "$tmpfile" "$url"
            fi

            chmod +x "$tmpfile"
            rm -f "$INSTALL_DIR/jackdaw"
            mv "$tmpfile" "$INSTALL_DIR/jackdaw"
            trap - EXIT
            ;;
    esac

    # Desktop entry (Linux only)
    if [ "$os" = "linux" ]; then
        install_desktop_entry
    fi

    echo "Installed jackdaw to $INSTALL_DIR/jackdaw"

    # Check PATH
    case ":$PATH:" in
        *":$INSTALL_DIR:"*) ;;
        *) echo "Warning: $INSTALL_DIR is not in your PATH. Add it with:"
           echo "  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
    esac
}

install_desktop_entry() {
    desktop_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
    icon_dir="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/128x128/apps"
    mkdir -p "$desktop_dir" "$icon_dir"

    icon_url="https://raw.githubusercontent.com/$REPO/$tag/src-tauri/icons/128x128.png"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$icon_url" -o "$icon_dir/jackdaw.png"
    else
        wget -qO "$icon_dir/jackdaw.png" "$icon_url"
    fi

    cat > "$desktop_dir/jackdaw.desktop" << DESKTOP
[Desktop Entry]
Name=Jackdaw
Comment=Monitor Claude Code sessions
Exec=$INSTALL_DIR/jackdaw
Icon=jackdaw
Type=Application
Categories=Development;Utility;
StartupNotify=true
DESKTOP
    echo "Installed desktop entry to $desktop_dir/jackdaw.desktop"
}

main
