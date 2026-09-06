---
name: immortalwrt-build-system
description: >-
  ImmortalWrt/OpenWrt build system — Makefile targets, feeds, menuconfig, package
  compile, clean targets. Use when building immortalwrt on Linux or via macOS Docker
  wrapper, or when explaining prepare/world/stamp-compile pipeline.
---

# ImmortalWrt build system

## Prerequisites

- GNU/Linux (Debian 11+ preferred) or **macOS via Docker** (`Documents/ build_immortalwrt/`)
- Path must **not contain spaces** (`Makefile` enforces this)
- Case-sensitive filesystem required

Upstream macOS native build is **not recommended** — use Docker wrapper instead.

## Standard Linux workflow

```sh
cd immortalwrt
./scripts/feeds update -a
./scripts/feeds install -a
make menuconfig   # Target: rockchip → armv8 → xunlong_orangepi-cm5-base
make -j$(nproc) V=s
```

## Makefile pipeline (`make world`)

```text
.config + tools + toolchain
  → target/stamp-compile      (kernel, device tree)
  → package/stamp-compile     (all selected packages)
  → package/stamp-install
  → target/stamp-install      (rootfs + images)
  → package/index             (apk index)
```

Utility targets: `prepare`, `clean`, `dirclean`, `targetclean`, `cacheclean`, `buildinfo`, `checksum`.

## Single package

```sh
make package/blocky/compile V=s
make package/luci-app-blocky/compile V=s
```

Requires feeds installed and `.config` with target selected.

## Feeds

Default: `feeds.conf.default` (ImmortalWrt packages, luci, …).

CM5 macOS builds use minimal `feeds.conf.cm5` + auto-mounted `openwrt_packages` for custom packages (`luci-app-oled`, `luci-app-mcu-display`, `luci-app-peripherals`, `cm5-button-scripts`, …).

```sh
./scripts/feeds update openwrt_packages
./scripts/feeds install -p openwrt_packages -a
```

Custom feed packages are **baked into the image**. Do not expect runtime `apk` downloads from `openwrt_packages` / `awgopenwrt` mirrors (CM5 strips those URLs via `97-cm5-apk-feeds`).

## macOS (Docker)

```sh
"/Users/t-rex-xp/Documents/ build_immortalwrt/scripts/build-immortalwrt-macos.sh" \
  --source /Users/t-rex-xp/Documents/immortalwrt \
  --device xunlong_orangepi-cm5-base
```

Source is rsync'd to Linux `/work/immortalwrt` inside container; host tree stays read-only input.

## Clean / reset

| Command | Effect |
|---------|--------|
| `make clean` | `build_dir/`, `staging_dir/`, `bin/` |
| `make dirclean` | + host staging, config cache |
| Docker `--reset-work-cache` | Reset container work volume (macOS) |

## Config validation without full compile

```sh
IMMORTALWRT_STOP_AFTER_CONFIG=1 \
  build-immortalwrt-macos.sh --source /path/to/immortalwrt
```

## Do not

- Run `make` on macOS host directly for firmware
- Put spaces in checkout path
- Edit `build_dir/` or `staging_dir/` in source tree expecting Docker cache sync
