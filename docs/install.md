# Installing the dependencies

Needed only to run without Docker — see [Run without Docker](../README.md#run-without-docker).

| Dependency | Version | Needed for |
|---|---|---|
| **Rust** | 1.87+ | the mbox and calendar parsers |
| **Node.js** | 20.19+ | the webapp (CI builds on Node 24) |
| **C compiler** | any | building the parsers — SQLite is compiled in from C |
| **GNU Make** | any | optional — every step also has a plain `cargo` / `npm` form |

**Rust 1.87+** — install via [rustup](https://rustup.rs), which is the same on
every platform:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

On Windows, download and run [`rustup-init.exe`](https://rustup.rs) instead.
Already have Rust? Update it:

```bash
rustup update stable
```

Verify with `cargo --version` — it must report 1.87.0 or newer. The version is
declared as `rust-version` in each `Cargo.toml`, so an older toolchain fails
with a clear message instead of a confusing compile error.

**Node.js 20.19+** — download the LTS installer from
[nodejs.org](https://nodejs.org), or use a version manager:

```bash
# nvm (macOS / Linux)
nvm install 24
nvm use 24
```

```bash
# Debian / Ubuntu, via NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

```bash
# macOS, via Homebrew
brew install node
```

Verify with `node --version`.

**C compiler** — rusqlite builds its bundled SQLite from C:

```bash
# Debian / Ubuntu
sudo apt-get update
sudo apt-get install -y build-essential
```

```bash
# Fedora / RHEL
sudo dnf install -y gcc
```

```bash
# Arch
sudo pacman -S --needed base-devel
```

```bash
# Alpine
sudo apk add build-base
```

```bash
# macOS — Xcode command line tools
xcode-select --install
```

On Windows the MSVC build tools that rustup asks for are enough.

**GNU Make** — optional.

```bash
# Debian / Ubuntu
sudo apt-get install -y make
```

```bash
# macOS — included with the Xcode command line tools
xcode-select --install
```

On Windows, `make` comes with [Git for Windows](https://gitforwindows.org) when
you install the optional Unix tools, or via `choco install make`. If you would
rather not install it, use the "Without `make`" commands instead.
