# Agent guide — immortalwrt (CM5 fork)

Fork of [OpenWrt](https://openwrt.org) / [ImmortalWrt](https://github.com/immortalwrt/immortalwrt) with local changes for **Orange Pi CM5 Base** and related packages from the sibling `openwrt-packages` feed.

**Do not build firmware directly on macOS** — use the Docker wrapper in `Documents/ build_immortalwrt/` (see that repo's `AGENTS.md`).

## Build system (`Makefile`)

Top-level `make world` pipeline:

```text
prepare → target/stamp-compile → package/stamp-compile →
package/stamp-install → target/stamp-install → package/index
```

Common targets:

| Target | Purpose |
|--------|---------|
| `make menuconfig` | Select target, device profile, packages |
| `make` / `make world` | Full firmware build |
| `make prepare` | Toolchain + target prep only |
| `make clean` | Remove `build_dir/`, `staging_dir/`, `bin/` |
| `make dirclean` | Deep clean including host staging |
| `make package/foo/compile V=s` | Single package |

Requirements (from upstream README): GNU/Linux preferred, **no spaces in path**, case-sensitive filesystem.

## CM5 default profile

| Setting | Value |
|---------|-------|
| Board | `rockchip` |
| Subtarget | `armv8` |
| Default profile | `xunlong_orangepi-cm5-base` |
| Kernel | `6.18` (`KERNEL_PATCHVER` in `target/linux/rockchip/Makefile`) |
| LAN | `192.168.8.1/24`, `br-lan` on `eth1` + `eth2` |
| WAN | `eth0` (onboard) |

Artifacts (after build):

```text
bin/targets/rockchip/armv8/
```

## Key paths (CM5 work)

```text
target/linux/rockchip/
  Makefile                          # BOARD, KERNEL_PATCHVER
  armv8/target.mk                   # DEFAULT_PROFILE
  image/armv8.mk                    # Device/xunlong_orangepi-cm5-base, DEVICE_PACKAGES
  image/orangepi-cm5-base.bootscript
  patches-6.18/994-*-cm5-*.patch  # DTS bring-up
  patches-6.18/995-*-fan.patch
  patches-6.18/996-*-vbus.patch
  patches-6.18/997-*-buttons.patch
  patches-6.18/998-*-i2c7*.patch      # FPC I2C for OLED HAT
  patches-6.18/999-*-oled-rst*.patch  # panel RST gpio (see openwrt-packages wiring doc)
  armv8/base-files/                 # Runtime: network, wifi, buttons, uci-defaults
```

## DEVICE_PACKAGES (CM5)

Defined in `target/linux/rockchip/image/armv8.mk` under `Device/xunlong_orangepi-cm5-base`. Includes:

- Network: `kmod-r8125`, WireGuard, AmneziaWG, Tailscale, PBR, …
- DNS: `blocky`, `luci-app-blocky` (from **openwrt-packages** feed)
- UI: `luci-ssl`, `luci-app-peripherals`, `luci-app-buttons`, `luci-app-oled`, …
- OLED (feed): `oledd` menu on `/dev/i2c-7` (CM5 Waveshare HAT); LuCI **Services → OLED**; low-level I2C scan in **System → Peripherals**
- Platform: `kmod-hwmon-pwmfan`, `cm5-button-scripts`, Docker stack, USB Wi-Fi modules

Custom feed packages (`blocky`, `luci-app-*`, `cm5-button-scripts`) require `openwrt_packages` feed at build time.

## Development rules

1. **Kernel/DTS changes** — edit patches under `patches-6.18/` or source in `immortal_opi_cm5/dts-src/` then export patches (994–997 series for CM5).
2. **Runtime behavior** — prefer `armv8/base-files/etc/uci-defaults/` for first-boot migration; `board.d/` for initial network layout.
3. **Scope** — CM5 changes should not break other `rockchip/armv8` devices; use `board_name` guards in shell scripts.
4. **Package recipes** — daemons and LuCI apps belong in **openwrt-packages**, not duplicated here; add package names to `DEVICE_PACKAGES` only.
5. **macOS builds** — always via `Documents/ build_immortalwrt/scripts/build-immortalwrt-macos.sh --source $(pwd)`.
6. **Commits** — only when the user explicitly asks.

## Related repositories

| Repo | Role |
|------|------|
| `Documents/ build_immortalwrt/` | macOS Docker build wrapper |
| `openwrt-packages/` | Custom feed: blocky, luci-app-*, cm5-button-scripts |
| `immortal_opi_cm5/` | DTS source, patch export, dev docker-compose |

## Recommended macOS build

```sh
cd "Documents/ build_immortalwrt"

./scripts/build-immortalwrt-macos.sh \
  --source /Users/t-rex-xp/Documents/immortalwrt \
  --device xunlong_orangepi-cm5-base
```

## Project skills

| Skill | When to use |
|-------|-------------|
| `immortalwrt-build-system` | Makefile targets, feeds, menuconfig, single-package builds |
| `rockchip-cm5-target` | armv8.mk profile, DEVICE_PACKAGES, bootscript, image layout |
| `cm5-base-files` | board.d, uci-defaults, Wi-Fi, network migrate, buttons |
| `rockchip-kernel-dts` | patches-6.18, CM5 DTS/fan/buttons, patch export workflow |

## References

- [README.md](README.md) — upstream ImmortalWrt quickstart
- [OpenWrt build system](https://openwrt.org/docs/guide-developer/build-system/install-buildsystem)
- [openwrt-packages AGENTS.md](../openwrt-packages/AGENTS.md)
- `Documents/ build_immortalwrt/README.md` — macOS Docker builder
