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

    sudo dpkg -i "$deb_file"
    trap - EXIT
    rm -rf "$tmpdir"
}

install_from_rpm() {
    rpm_url="$1"
    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT

    rpm_file="$tmpdir/jackdaw.rpm"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$rpm_url" -o "$rpm_file"
    else
        wget -qO "$rpm_file" "$rpm_url"
    fi

    sudo rpm -U "$rpm_file"
    trap - EXIT
    rm -rf "$tmpdir"
}

install_from_appimage() {
    appimage_url="$1"
    mkdir -p "$INSTALL_DIR"

    tmpfile=$(mktemp "$INSTALL_DIR/jackdaw.XXXXXX")
    trap 'rm -f "$tmpfile"' EXIT

    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$appimage_url" -o "$tmpfile"
    else
        wget -qO "$tmpfile" "$appimage_url"
    fi

    chmod +x "$tmpfile"
    rm -f "$INSTALL_DIR/jackdaw"
    mv "$tmpfile" "$INSTALL_DIR/jackdaw"
    trap - EXIT
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
}

cleanup_old_install() {
    if [ -f "$HOME/.local/bin/jackdaw" ]; then
        echo "Removing old install at ~/.local/bin/jackdaw"
        rm -f "$HOME/.local/bin/jackdaw"
    fi
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

    # Determine artifact names from release assets
    if command -v curl >/dev/null 2>&1; then
        assets=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"name"' | cut -d'"' -f4)
    else
        assets=$(wget -qO- "https://api.github.com/repos/$REPO/releases/latest" | grep '"name"' | cut -d'"' -f4)
    fi

    echo "Installing Jackdaw $tag for $os/$arch..."

    case "$os" in
        linux)
            if command -v dpkg >/dev/null 2>&1; then
                artifact=$(echo "$assets" | grep -i '\.deb$' | head -1)
                url="https://github.com/$REPO/releases/download/$tag/$artifact"
                install_from_deb "$url"
                cleanup_old_install
                echo "Installed Jackdaw $tag via deb package"
            elif command -v rpm >/dev/null 2>&1; then
                artifact=$(echo "$assets" | grep -i '\.rpm$' | head -1)
                url="https://github.com/$REPO/releases/download/$tag/$artifact"
                install_from_rpm "$url"
                cleanup_old_install
                echo "Installed Jackdaw $tag via rpm package"
            else
                artifact=$(echo "$assets" | grep -i '\.AppImage$' | head -1)
                url="https://github.com/$REPO/releases/download/$tag/$artifact"
                install_from_appimage "$url"
                install_desktop_entry
                echo "Installed Jackdaw $tag to $INSTALL_DIR/jackdaw"
                case ":$PATH:" in
                    *":$INSTALL_DIR:"*) ;;
                    *) echo "Warning: $INSTALL_DIR is not in your PATH. Add it with:"
                       echo "  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
                esac
            fi
            ;;
        darwin)
            artifact=$(echo "$assets" | grep -i '\.dmg$' | head -1)
            url="https://github.com/$REPO/releases/download/$tag/$artifact"
            mkdir -p "$INSTALL_DIR"
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

            echo "Installed Jackdaw $tag to $INSTALL_DIR/jackdaw"
            case ":$PATH:" in
                *":$INSTALL_DIR:"*) ;;
                *) echo "Warning: $INSTALL_DIR is not in your PATH. Add it with:"
                   echo "  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
            esac
            ;;
        *)
            echo "Unsupported OS: $os"
            exit 1
            ;;
    esac
}

main
