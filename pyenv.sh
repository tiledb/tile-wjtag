#!/usr/bin/env bash
# Interactive Python venv (.pyenv) + system package manager helper.
# Run:  ./pyenv.sh
# Or:   source pyenv.sh   (needed for Activate to affect your current shell)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VENV_DIR="$SCRIPT_DIR/.pyenv"
REQ_FILE="$SCRIPT_DIR/pyenv-requirements.txt"
PYTHON_BIN="python3"

SERVICE_NAME="tile-wjtag.service"
SERVICE_TEMPLATE="$SCRIPT_DIR/tile-wjtag.service"
SERVICE_DEST="/etc/systemd/system/${SERVICE_NAME}"

# Detect whether this file was sourced (activate/deactivate only then)
_SOURCED=0
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  _SOURCED=1
fi

# ---------------------------------------------------------------------------
# Colors / UI helpers
# ---------------------------------------------------------------------------
if [[ -t 1 ]] && command -v tput &>/dev/null && [[ $(tput colors 2>/dev/null || echo 0) -ge 8 ]]; then
  C_RESET="$(tput sgr0)"
  C_BOLD="$(tput bold)"
  C_DIM="$(tput dim)"
  C_RED="$(tput setaf 1)"
  C_GREEN="$(tput setaf 2)"
  C_YELLOW="$(tput setaf 3)"
  C_CYAN="$(tput setaf 6)"
  C_REV="$(tput rev)"
else
  C_RESET="" C_BOLD="" C_DIM="" C_RED="" C_GREEN="" C_YELLOW="" C_CYAN="" C_REV=""
fi

ok()   { printf '%s✔%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail() { printf '%s✘%s %s\n' "$C_RED" "$C_RESET" "$*"; }
info() { printf '%s•%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }

pause() {
  echo
  read -r -p "Press Enter to continue..." _ <"${_TTY:-/dev/tty}"
}

# ---------------------------------------------------------------------------
# Package manager detection & package lists
# ---------------------------------------------------------------------------
detect_pkg_mgr() {
  if command -v apt-get &>/dev/null; then
    PKG_MGR="apt"
  elif command -v dnf &>/dev/null; then
    PKG_MGR="dnf"
  elif command -v pacman &>/dev/null; then
    PKG_MGR="pacman"
  else
    PKG_MGR=""
  fi
}

# System packages needed to build/run this project's Python deps (Pillow, etc.)
set_sys_packages() {
  case "$PKG_MGR" in
    apt)
      SYS_PACKAGES=(
        python3
        python3-venv
        python3-pip
        python3-dev
        build-essential
        libjpeg-dev
        zlib1g-dev
        libpng-dev
        libfreetype6-dev
        libffi-dev
        libssl-dev
      )
      ;;
    dnf)
      SYS_PACKAGES=(
        python3
        python3-pip
        python3-devel
        gcc
        gcc-c++
        make
        libjpeg-turbo-devel
        zlib-devel
        libpng-devel
        freetype-devel
        libffi-devel
        openssl-devel
      )
      ;;
    pacman)
      SYS_PACKAGES=(
        python
        python-pip
        base-devel
        libjpeg-turbo
        zlib
        libpng
        freetype2
        libffi
        openssl
      )
      ;;
    *)
      SYS_PACKAGES=()
      ;;
  esac
}

pkg_is_installed() {
  local pkg="$1"
  case "$PKG_MGR" in
    apt)    dpkg -s "$pkg" &>/dev/null ;;
    dnf)    rpm -q "$pkg" &>/dev/null ;;
    pacman) pacman -Qi "$pkg" &>/dev/null ;;
    *)      return 1 ;;
  esac
}

sys_install() {
  if [[ -z "$PKG_MGR" ]]; then
    fail "No supported package manager found (apt, dnf, or pacman)."
    return 1
  fi
  info "Installing system packages via $PKG_MGR..."
  case "$PKG_MGR" in
    apt)
      sudo apt-get update
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${SYS_PACKAGES[@]}"
      ;;
    dnf)
      sudo dnf install -y "${SYS_PACKAGES[@]}"
      ;;
    pacman)
      sudo pacman -Sy --needed --noconfirm "${SYS_PACKAGES[@]}"
      ;;
  esac
}

sys_remove() {
  if [[ -z "$PKG_MGR" ]]; then
    fail "No supported package manager found (apt, dnf, or pacman)."
    return 1
  fi
  # Keep the core Python interpreter; only remove build/dev helpers we added.
  local removable=()
  case "$PKG_MGR" in
    apt)
      removable=(python3-venv python3-pip python3-dev build-essential
                 libjpeg-dev zlib1g-dev libpng-dev libfreetype6-dev libffi-dev libssl-dev)
      ;;
    dnf)
      removable=(python3-pip python3-devel gcc gcc-c++ make
                 libjpeg-turbo-devel zlib-devel libpng-devel freetype-devel libffi-devel openssl-devel)
      ;;
    pacman)
      removable=(python-pip base-devel libjpeg-turbo zlib libpng freetype2 libffi)
      ;;
  esac

  warn "This will attempt to remove build/dev packages (not core python)."
  read -r -p "Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { info "Cancelled."; return 0; }

  case "$PKG_MGR" in
    apt)    sudo apt-get remove -y "${removable[@]}" ;;
    dnf)    sudo dnf remove -y "${removable[@]}" ;;
    pacman) sudo pacman -Rns --noconfirm "${removable[@]}" 2>/dev/null || sudo pacman -R --noconfirm "${removable[@]}" ;;
  esac
}

# ---------------------------------------------------------------------------
# Venv + pip
# ---------------------------------------------------------------------------
venv_exists() { [[ -d "$VENV_DIR" && -x "$VENV_DIR/bin/python" ]]; }

venv_is_active() {
  [[ -n "${VIRTUAL_ENV:-}" && "$(realpath "${VIRTUAL_ENV}" 2>/dev/null)" == "$(realpath "$VENV_DIR" 2>/dev/null)" ]]
}

venv_create() {
  if ! command -v "$PYTHON_BIN" &>/dev/null; then
    fail "python3 not found. Install system packages first."
    return 1
  fi
  if venv_exists; then
    info "Virtual environment '$VENV_DIR' already exists."
    return 0
  fi
  info "Creating virtual environment in $VENV_DIR ..."
  "$PYTHON_BIN" -m venv "$VENV_DIR"
  ok "Created $VENV_DIR"
}

venv_remove() {
  if ! venv_exists; then
    info "No '$VENV_DIR' to remove."
    return 0
  fi
  if venv_is_active; then
    fail "Deactivate the venv before removing it (choose Deactivate, or run: deactivate)."
    return 1
  fi
  warn "This will permanently delete $VENV_DIR"
  read -r -p "Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { info "Cancelled."; return 0; }
  rm -rf "$VENV_DIR"
  ok "Removed $VENV_DIR"
}

pip_bin() {
  if venv_exists; then
    echo "$VENV_DIR/bin/pip"
  else
    echo ""
  fi
}

pip_install_reqs() {
  if ! venv_exists; then
    fail "Create .pyenv first."
    return 1
  fi
  if [[ ! -f "$REQ_FILE" ]]; then
    fail "Missing $REQ_FILE"
    return 1
  fi
  local pip
  pip="$(pip_bin)"
  info "Upgrading pip..."
  "$pip" install --upgrade pip
  info "Installing from $REQ_FILE ..."
  if ! "$pip" install -r "$REQ_FILE"; then
    warn "Pinned install failed (often Python version mismatch). Retrying without pins..."
    # Strip ==version pins and retry for newer Pythons
    local tmp
    tmp="$(mktemp)"
    sed -E 's/==.*//' "$REQ_FILE" > "$tmp"
    "$pip" install -r "$tmp"
    local rc=$?
    rm -f "$tmp"
    return $rc
  fi
}

pip_uninstall_reqs() {
  if ! venv_exists; then
    fail "No .pyenv found."
    return 1
  fi
  if [[ ! -f "$REQ_FILE" ]]; then
    fail "Missing $REQ_FILE"
    return 1
  fi
  local pip names
  pip="$(pip_bin)"
  mapfile -t names < <(sed -E 's/[[:space:]]*#.*//; /^[[:space:]]*$/d; s/[=<>!~].*//' "$REQ_FILE")
  if [[ ${#names[@]} -eq 0 ]]; then
    info "No packages listed in $REQ_FILE"
    return 0
  fi
  warn "Uninstalling ${#names[@]} package(s) from $REQ_FILE"
  read -r -p "Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { info "Cancelled."; return 0; }
  "$pip" uninstall -y "${names[@]}"
}

venv_activate() {
  if ! venv_exists; then
    fail "Create .pyenv first."
    return 1
  fi
  if [[ $_SOURCED -eq 1 ]]; then
    # shellcheck disable=SC1091
    source "$VENV_DIR/bin/activate"
    ok "Activated $VENV_DIR (VIRTUAL_ENV=$VIRTUAL_ENV)"
  else
    warn "This script was executed, not sourced — activate cannot change your current shell."
    echo
    info "Run one of:"
    echo "  source $SCRIPT_DIR/pyenv.sh"
    echo "    (then choose Activate in the menu)"
    echo "  source $VENV_DIR/bin/activate"
  fi
}

venv_deactivate() {
  if [[ $_SOURCED -eq 1 ]]; then
    if declare -F deactivate &>/dev/null; then
      deactivate
      ok "Deactivated virtual environment."
    else
      info "No active venv function in this shell."
    fi
  else
    if venv_is_active; then
      warn "Script was not sourced; run: deactivate"
    else
      info "Venv does not appear active in this process."
      echo "  In a shell where it is active, run: deactivate"
      echo "  Or: source $SCRIPT_DIR/pyenv.sh  → choose Deactivate"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------
show_status() {
  clear 2>/dev/null || true
  echo "${C_BOLD}=== Environment status ===${C_RESET}"
  echo
  echo "${C_BOLD}System${C_RESET}"
  if [[ -n "$PKG_MGR" ]]; then
    ok "Package manager: $PKG_MGR"
  else
    fail "Package manager: none detected"
  fi
  if command -v "$PYTHON_BIN" &>/dev/null; then
    ok "System Python: $($PYTHON_BIN --version 2>&1)"
  else
    fail "System Python: not found"
  fi

  local missing=() installed=()
  for pkg in "${SYS_PACKAGES[@]}"; do
    if pkg_is_installed "$pkg"; then
      installed+=("$pkg")
    else
      missing+=("$pkg")
    fi
  done
  if [[ ${#SYS_PACKAGES[@]} -gt 0 ]]; then
    if [[ ${#missing[@]} -eq 0 ]]; then
      ok "System packages: all ${#installed[@]} present"
    else
      warn "System packages: ${#installed[@]} installed, ${#missing[@]} missing"
      for p in "${missing[@]}"; do
        echo "    ${C_RED}- $p${C_RESET}"
      done
    fi
  fi

  echo
  echo "${C_BOLD}Virtualenv (.pyenv)${C_RESET}"
  if venv_exists; then
    ok "Exists: $($VENV_DIR/bin/python --version 2>&1)"
    info "Path: $VENV_DIR"
  else
    fail "Does not exist"
  fi
  if venv_is_active; then
    ok "Active in this shell (VIRTUAL_ENV=$VIRTUAL_ENV)"
  else
    info "Not active in this shell"
  fi
  if [[ $_SOURCED -eq 1 ]]; then
    ok "pyenv.sh is sourced (Activate/Deactivate will work)"
  else
    warn "pyenv.sh is not sourced — Activate needs: source ./pyenv.sh"
  fi

  echo
  echo "${C_BOLD}Pip requirements (pyenv-requirements.txt)${C_RESET}"
  if ! venv_exists; then
    fail "Cannot check pip packages without .pyenv"
  elif [[ ! -f "$REQ_FILE" ]]; then
    fail "Missing $REQ_FILE"
  else
    local pip name want have miss=0
    pip="$(pip_bin)"
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%%#*}"
      line="${line#"${line%%[![:space:]]*}"}"
      line="${line%"${line##*[![:space:]]}"}"
      [[ -z "$line" ]] && continue
      name="${line%%[=<>!~]*}"
      name="${name%"${name##*[![:space:]]}"}"
      want=""
      if [[ "$line" == *==* ]]; then
        want="${line#*==}"
      fi
      have="$("$pip" show "$name" 2>/dev/null | awk -F': ' '/^Version:/{print $2}')"
      if [[ -z "$have" ]]; then
        fail "$name (not installed)"
        miss=$((miss + 1))
      elif [[ -n "$want" && "$have" != "$want" ]]; then
        warn "$name installed=$have required=$want"
      else
        ok "$name $have"
      fi
    done < "$REQ_FILE"
    if [[ $miss -eq 0 ]]; then
      echo
      ok "All listed packages are present (versions may differ if pins were relaxed)."
    fi
  fi

  echo
  echo "${C_BOLD}Systemd ($SERVICE_NAME)${C_RESET}"
  show_service_status
  pause
}

# ---------------------------------------------------------------------------
# systemd unit (tile-wjtag.service)
# ---------------------------------------------------------------------------
service_unit_installed() { [[ -f "$SERVICE_DEST" ]]; }

# Prefer the invoking user when run under sudo
service_run_user() {
  if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
    echo "$SUDO_USER"
  elif id -u tiledb &>/dev/null; then
    echo "tiledb"
  else
    echo "$(id -un)"
  fi
}

service_run_group() {
  local u
  u="$(service_run_user)"
  id -gn "$u" 2>/dev/null || echo "$u"
}

render_service_unit() {
  local user group out
  user="$(service_run_user)"
  group="$(service_run_group)"
  if [[ ! -f "$SERVICE_TEMPLATE" ]]; then
    fail "Missing template: $SERVICE_TEMPLATE" >&2
    return 1
  fi
  out="$(mktemp)"
  sed -e "s|__APP_ROOT__|$SCRIPT_DIR|g" \
      -e "s|__VENV_DIR__|$VENV_DIR|g" \
      -e "s|__USER__|$user|g" \
      -e "s|__GROUP__|$group|g" \
      "$SERVICE_TEMPLATE" > "$out"
  # Drop comment lines from the installed unit
  sed -i '/^#/d' "$out"
  # Trim leading blank lines left by removed comments
  sed -i '/./,$!d' "$out"
  echo "$out"
}

show_service_status() {
  if [[ ! -f "$SERVICE_TEMPLATE" ]]; then
    fail "Template missing: $SERVICE_TEMPLATE"
  else
    ok "Template: $SERVICE_TEMPLATE"
  fi

  if service_unit_installed; then
    ok "Installed: $SERVICE_DEST"
  else
    fail "Not installed at $SERVICE_DEST"
  fi

  if ! command -v systemctl &>/dev/null; then
    warn "systemctl not found"
    return 0
  fi

  if systemctl is-enabled "$SERVICE_NAME" &>/dev/null; then
    ok "Enabled at boot"
  else
    info "Not enabled at boot ($(systemctl is-enabled "$SERVICE_NAME" 2>&1 || true))"
  fi

  local st
  st="$(systemctl is-active "$SERVICE_NAME" 2>&1 || true)"
  case "$st" in
    active) ok "Active (running)" ;;
    inactive) info "Inactive (stopped)" ;;
    failed) fail "Failed" ;;
    *) warn "State: $st" ;;
  esac
}

# Standalone service status view (menu / CLI)
show_service_status_page() {
  clear 2>/dev/null || true
  echo "${C_BOLD}=== Systemd service status ($SERVICE_NAME) ===${C_RESET}"
  echo
  show_service_status
  echo
  if command -v systemctl &>/dev/null && service_unit_installed; then
    echo "${C_BOLD}systemctl status${C_RESET}"
    systemctl status "$SERVICE_NAME" --no-pager -l 2>&1 || true
    echo
    echo "${C_BOLD}Recent journal (last 20)${C_RESET}"
    journalctl -u "$SERVICE_NAME" -n 20 --no-pager 2>&1 || true
  fi
  pause
}

service_install() {
  if [[ ! -f "$SERVICE_TEMPLATE" ]]; then
    fail "Missing template: $SERVICE_TEMPLATE"
    return 1
  fi
  if ! venv_exists; then
    warn ".pyenv missing — service ExecStart will fail until the venv exists."
    read -r -p "Install the unit anyway? [y/N] " ans <"${_TTY:-/dev/tty}"
    [[ "$ans" =~ ^[Yy]$ ]] || { info "Cancelled."; return 0; }
  fi

  local rendered user
  rendered="$(render_service_unit)" || return 1
  user="$(service_run_user)"

  info "Installing $SERVICE_NAME as User=$user"
  info "  ExecStart → $VENV_DIR/bin/python $SCRIPT_DIR/tile_db_wjtag/app.py"
  sudo cp "$rendered" "$SERVICE_DEST"
  rm -f "$rendered"
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  ok "Installed and enabled: $SERVICE_DEST"

  read -r -p "Start (or restart) the service now? [Y/n] " ans <"${_TTY:-/dev/tty}"
  if [[ ! "$ans" =~ ^[Nn]$ ]]; then
    sudo systemctl restart "$SERVICE_NAME"
    show_service_status
  fi
}

service_remove() {
  if ! service_unit_installed; then
    info "No unit at $SERVICE_DEST"
    return 0
  fi
  warn "This will stop, disable, and delete $SERVICE_DEST"
  read -r -p "Continue? [y/N] " ans <"${_TTY:-/dev/tty}"
  [[ "$ans" =~ ^[Yy]$ ]] || { info "Cancelled."; return 0; }

  sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  sudo rm -f "$SERVICE_DEST"
  sudo systemctl daemon-reload
  ok "Removed $SERVICE_NAME"
}

service_start() {
  service_unit_installed || { fail "Install the service first."; return 1; }
  sudo systemctl start "$SERVICE_NAME"
  show_service_status
}

service_stop() {
  service_unit_installed || { fail "Service not installed."; return 1; }
  sudo systemctl stop "$SERVICE_NAME"
  show_service_status
}

service_restart() {
  service_unit_installed || { fail "Install the service first."; return 1; }
  sudo systemctl restart "$SERVICE_NAME"
  show_service_status
}

# ---------------------------------------------------------------------------
# Full setup (system → venv → pip)
# ---------------------------------------------------------------------------
full_setup() {
  echo "${C_BOLD}Full setup${C_RESET}"
  sys_install || return 1
  venv_create || return 1
  pip_install_reqs || return 1
  echo
  ok "Setup complete."
  info "Activate with: source $VENV_DIR/bin/activate"
  echo "  or: source $SCRIPT_DIR/pyenv.sh  → Activate"
  echo
  read -r -p "Install/enable systemd service ($SERVICE_NAME)? [Y/n] " ans <"${_TTY:-/dev/tty}"
  if [[ ! "$ans" =~ ^[Nn]$ ]]; then
    service_install || true
  fi
  pause
}

# ---------------------------------------------------------------------------
# Keyboard menu (↑/↓ or j/k, Enter, q)
# UI must go to /dev/tty — never wrap the menu in $(...) or output is swallowed.
# ---------------------------------------------------------------------------
_TTY="/dev/tty"

draw_menu() {
  local selected=$1
  shift
  local items=("$@")
  local i
  clear >"$_TTY" 2>/dev/null || true
  {
    echo "${C_BOLD}tile-wjtag · pyenv manager${C_RESET}"
    echo "${C_DIM}↑/↓ or j/k to move · Enter select · q quit${C_RESET}"
    echo
    for i in "${!items[@]}"; do
      if [[ $i -eq $selected ]]; then
        printf '  %s› %s%s\n' "$C_REV$C_BOLD" "${items[$i]}" "$C_RESET"
      else
        printf '    %s\n' "${items[$i]}"
      fi
    done
    echo
  } >"$_TTY"
}

# Sets MENU_KEY to: up | down | enter | quit | other
read_key() {
  local k rest
  MENU_KEY="other"
  # Read directly from the terminal (works even inside pipelines/subshells)
  IFS= read -rsn1 k <"$_TTY" || return 1
  if [[ $k == $'\x1b' ]]; then
    # Arrow keys send ESC [ A/B — don't block forever if lone ESC
    if IFS= read -rsn1 -t 0.2 rest <"$_TTY"; then
      k+="$rest"
      if [[ $rest == '[' ]]; then
        IFS= read -rsn1 rest <"$_TTY" || true
        k+="$rest"
      fi
    else
      MENU_KEY="quit"
      return 0
    fi
  fi
  case "$k" in
    $'\x1b[A'|k|K) MENU_KEY="up" ;;
    $'\x1b[B'|j|J) MENU_KEY="down" ;;
    ''|$'\n'|$'\r'|l|L) MENU_KEY="enter" ;;
    q|Q) MENU_KEY="quit" ;;
    *) MENU_KEY="other" ;;
  esac
}

# Sets MENU_CHOICE to selected index, or -1 on quit
menu_select() {
  local items=("$@")
  local n=${#items[@]}
  local sel=0
  MENU_CHOICE=-1

  while true; do
    draw_menu "$sel" "${items[@]}"
    read_key || { MENU_CHOICE=-1; return 1; }
    case "$MENU_KEY" in
      up)   sel=$(( (sel - 1 + n) % n )) ;;
      down) sel=$(( (sel + 1) % n )) ;;
      enter) MENU_CHOICE=$sel; return 0 ;;
      quit) MENU_CHOICE=-1; return 0 ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main_menu() {
  detect_pkg_mgr
  set_sys_packages

  if [[ ! -r $_TTY || ! -w $_TTY ]]; then
    fail "No interactive terminal (/dev/tty). Use: ./pyenv.sh setup|status|..."
    return 1
  fi

  local items=(
    "Status — check system packages, .pyenv, pip, service"
    "Full setup — packages + .pyenv + pip (+ optional service)"
    "Install system packages (apt/dnf/pacman)"
    "Remove system build/dev packages"
    "Create .pyenv virtualenv"
    "Remove .pyenv virtualenv"
    "Install pip requirements (pyenv-requirements.txt)"
    "Uninstall pip requirements"
    "Activate .pyenv"
    "Deactivate .pyenv"
    "Show systemd service status"
    "Install/update systemd service ($SERVICE_NAME)"
    "Remove systemd service"
    "Start systemd service"
    "Stop systemd service"
    "Restart systemd service"
    "Quit"
  )
  local quit_idx=$((${#items[@]} - 1))

  while true; do
    menu_select "${items[@]}"
    case "$MENU_CHOICE" in
      -1|"$quit_idx") clear >"$_TTY" 2>/dev/null || true; info "Bye."; return 0 ;;
      0) show_status ;;
      1) full_setup ;;
      2) sys_install; pause ;;
      3) sys_remove; pause ;;
      4) venv_create; pause ;;
      5) venv_remove; pause ;;
      6) pip_install_reqs; pause ;;
      7) pip_uninstall_reqs; pause ;;
      8) venv_activate; pause ;;
      9) venv_deactivate; pause ;;
      10) show_service_status_page ;;
      11) service_install; pause ;;
      12) service_remove; pause ;;
      13) service_start; pause ;;
      14) service_stop; pause ;;
      15) service_restart; pause ;;
    esac
  done
}

# Non-interactive shortcuts: ./pyenv.sh setup|status|...
case "${1:-}" in
  setup)
    detect_pkg_mgr; set_sys_packages; full_setup
    ;;
  status)
    detect_pkg_mgr; set_sys_packages; show_status
    ;;
  activate)
    detect_pkg_mgr; set_sys_packages; venv_activate
    ;;
  deactivate)
    venv_deactivate
    ;;
  service-status)
    show_service_status_page
    ;;
  service-install|install-service)
    service_install
    ;;
  service-remove|remove-service)
    service_remove
    ;;
  service-start|start)
    service_start
    ;;
  service-stop|stop)
    service_stop
    ;;
  service-restart|restart)
    service_restart
    ;;
  ""|menu)
    main_menu
    ;;
  -h|--help|help)
    cat <<EOF
Usage:
  ./pyenv.sh              Interactive keyboard menu
  source ./pyenv.sh       Same menu; Activate/Deactivate affect this shell
  ./pyenv.sh setup        Full setup (packages + venv + pip + optional service)
  ./pyenv.sh status       Show status
  source ./pyenv.sh activate
  source ./pyenv.sh deactivate

  ./pyenv.sh service-status    Service-only status (+ journal)
  ./pyenv.sh service-install   Install/enable $SERVICE_NAME from template
  ./pyenv.sh service-remove    Stop/disable/remove unit
  ./pyenv.sh start|stop|restart

Template: tile-wjtag.service  →  $SERVICE_DEST
Venv:     pyenv-requirements.txt  →  .pyenv/
EOF
    ;;
  *)
    fail "Unknown command: $1 (try --help)"
    [[ $_SOURCED -eq 1 ]] && return 1 || exit 1
    ;;
esac
