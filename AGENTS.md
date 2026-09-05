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
  patches-6.18/994-*-cm5-*.patch    # DTS bring-up
  patches-6.18/995-*-fan.patch
  patches-6.18/996-*-vbus.patch
  patches-6.18/997-*-buttons.patch
  patches-6.18/998-*-i2c7*.patch    # FPC I2C for OLED HAT
  patches-6.18/9980-*-led-polarity*.patch  # WAN/LAN LED PWM polarity
  patches-6.18/999-*-oled-rst*.patch       # panel RST gpio (GPIO1_B4)
  patches-6.18/9999-*-oled-rst-pinctrl*.patch  # FPC I2C SoC pull-ups
  armv8/base-files/                 # Runtime: network, LEDs, wifi, buttons, uci-defaults
```

## DEVICE_PACKAGES (CM5)

Defined in `target/linux/rockchip/image/armv8.mk` under `Device/xunlong_orangepi-cm5-base`. Includes:

- Network: `kmod-r8125`, WireGuard, AmneziaWG, Tailscale, Cloudflared, WoL (`luci-app-wol` + `etherwake`) — (optional via feed)
- UI: `luci-ssl`, `luci-mod-*`, `luci-app-peripherals`, `luci-app-mcu-display`, `luci-app-blocky`, `luci-app-commands`
- MCU display (feed): `mcudd` on `/dev/ttyS2` (CM5 debug UART) or USB serial; LuCI **Services → MCU Display**; I2C scan in **System → Peripherals → I2C**
- Platform: `kmod-hwmon-pwmfan`, `cm5-button-scripts` (USERKEY/MaskROM; chains to mcudd via `hotplug-call button`), USB Wi-Fi (`kmod-mt76x2u`, `kmod-rtl8812au-ct`), `i2c-tools`, `gpiod-tools`, `openssh-sftp-server` (SCP/SFTP into Dropbear), `picocom`/`screen`/`socat` (MCU UART on `/dev/ttyS2`)
- Services: `nlbwmon`, `ttyd`, `blocky`, `luci-app-blocky`, **snort3** + `luci-app-snort3`, **suricata** + `suricata-etopen` + `tp-eventd` + `luci-app-threat-prevention` (IDS off by default; no Docker, travelmate, PBR, fwknopd, privoxy, watchcat, speedtest, SMB, DLNA, statistics, SQM)

Custom feed packages (`blocky`, `luci-app-blocky`, `luci-app-mcu-display`, `luci-app-peripherals`, `cm5-button-scripts`, `snort3`, `luci-app-snort3`, `suricata`, `suricata-etopen`, `tp-eventd`, `luci-app-threat-prevention`) require `openwrt_packages` feed at build time.

## Development rules

1. **Kernel/DTS changes** — edit patches under `patches-6.18/` or source in `immortal_opi_cm5/dts-src/` then export patches (994–9999 CM5 series).
2. **Runtime behavior** — prefer `armv8/base-files/etc/uci-defaults/` for first-boot migration; `board.d/` for initial network/LED/wireless layout.
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

## Live router (MCP + SSH)

After flash or sysupgrade, validate runtime on **`192.168.8.1`** via host MCP — not by building on macOS.

| Item | Location (sibling `openwrt-packages/`) |
|------|------------------------------------------|
| Setup | `scripts/setup-openwrt-mcp.sh` |
| Skill | **`openwrt-mcp-ssh`** — UCI/apk via `user-openwrt`; SSH for mcudd deploy + link test |
| Docs | `docs/openwrt-mcp-server.md` |

Use with **`cm5-base-files`** (expected UCI/LAN), **`mcu-display-cm5`** (ESP32 / Go mcudd / LuCI sidecar), **`blocky-dns-cm5`**, **`suricata-ids-cm5`**, and **`snort3-ids-cm5`** (skills in `openwrt-packages/`).

## Project skills

| Skill | When to use |
|-------|-------------|
| `immortalwrt-build-system` | Makefile targets, feeds, menuconfig, single-package builds |
| `rockchip-cm5-target` | armv8.mk profile, DEVICE_PACKAGES, bootscript, image layout |
| `cm5-base-files` | board.d, uci-defaults, Wi-Fi, LEDs, network migrate, buttons |
| `rockchip-kernel-dts` | patches-6.18, CM5 DTS/fan/buttons/LEDs/OLED, patch export |
| `openwrt-mcp-ssh` | Live CM5 validation (skill in `openwrt-packages/.cursor/skills/`) |
| `mcu-display-cm5` | ESP32 panel + Go mcudd + LuCI sidecar (skill in `openwrt-packages`) |
| `cm5-mcu-serial` | Direct `/dev/ttyS2` RDCP via picocom/screen/socat (skill in `openwrt-packages`) |
| `cm5-security-stack` | IDS/DNS tiers (skill in `openwrt-packages`) |
| `suricata-ids-cm5` | Suricata LuCI + ET Open (skill in `openwrt-packages`) |
| `snort3-ids-cm5` | Snort LuCI + generated Lua (skill in `openwrt-packages`) |

## References

- [README.md](README.md) — upstream ImmortalWrt quickstart
- [OpenWrt build system](https://openwrt.org/docs/guide-developer/build-system/install-buildsystem)
- [openwrt-packages AGENTS.md](../openwrt-packages/AGENTS.md)
- `Documents/ build_immortalwrt/README.md` — macOS Docker builder
