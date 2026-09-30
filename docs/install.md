# Installing the dependencies

Needed only to run without Docker — see [Run without Docker](../README.md#run-without-docker).

| Dependency | Version | Needed for |
|---|---|---|
| **Rust** | 1.87+ | the mbox and calendar parsers |
| **Node.js** | 20.19+ | the webapp (CI builds on Node 24) |
| **pkg-config** | any | building the parsers — locates system libraries |
| **OpenSSL headers** (`libssl-dev`) | any | building the parsers — TLS for the optional Hugging Face calls |
| **GNU Make** | any | optional — every step also has a plain `cargo` / `npm` form |

`pkg-config` and the OpenSSL development headers are the two that most often
bite: without them `cargo build` fails partway through with a `native-tls` /
`openssl-sys` error rather than a missing-dependency message. They are already
present on macOS (via Homebrew's OpenSSL) and on Windows (the build uses
Schannel), so in practice this is a Linux prerequisite.

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

**pkg-config and OpenSSL headers** — needed to compile the parsers' TLS stack:

```bash
# Debian / Ubuntu
sudo apt-get update
sudo apt-get install -y pkg-config libssl-dev build-essential
```

```bash
# Fedora / RHEL
sudo dnf install -y pkgconf-pkg-config openssl-devel gcc
```

```bash
# Arch
sudo pacman -S --needed pkgconf openssl base-devel
```

```bash
# Alpine
sudo apk add pkgconf openssl-dev build-base
```

```bash
# macOS — Xcode command line tools plus Homebrew OpenSSL
xcode-select --install
brew install pkg-config openssl@3
```

On Windows nothing extra is required: the build links against the system
Schannel TLS stack, so there are no OpenSSL headers to install.

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
