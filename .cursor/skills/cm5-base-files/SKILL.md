---
name: cm5-base-files
description: >-
  Orange Pi CM5 Base runtime files in ImmortalWrt — board.d network, uci-defaults,
  Wi-Fi scripts, button hotplug, network migration. Use when editing
  target/linux/rockchip/armv8/base-files/ for CM5 first-boot or LAN/DHCP behavior.
---

# CM5 base-files (runtime)

Path: `target/linux/rockchip/armv8/base-files/`

## Network layout (`etc/board.d/02_network`)

For `xunlong,orangepi-cm5-base`:

- **LAN:** `eth1` + `eth2` on `br-lan`, static `192.168.8.1`
- **WAN:** `eth0` (DHCP)
- PCIe paths pinned for stable interface naming:
  - `eth1` → `platform/a40c00000.pcie/.../0003:31:00.0`
  - `eth2` → `platform/a41000000.pcie/.../0004:41:00.0`

MACs: generated from eMMC CID (`mmcblk*`).

## Network migration (`etc/uci-defaults/99-opi-cm5-network-migrate`)

Fixes stale configs after flash/sysupgrade:

- Moves `br-lan` ports from `eth0` → `eth1` + `eth2`
- Sets LAN to `192.168.8.1/24` if still on `192.168.1.1` or `192.168.2.1`
- Ensures `network.wan` on `eth0`
- Runs once; marker: `/etc/.opi_cm5_network_migrated`

Always guard with `[ "$(board_name)" = "xunlong,orangepi-cm5-base" ]`.

## Buttons (`etc/uci-defaults/95-cm5-buttons`)

Fallback install of `/etc/rc.button/wps` and `/etc/rc.button/BTN_2` when `cm5-button-scripts` package is missing.

Preferred source: **openwrt-packages** `cm5-button-scripts` package.

## Wi-Fi

| File | Role |
|------|------|
| `lib/cm5-base-wifi.sh` | Shared Wi-Fi helpers |
| `etc/uci-defaults/94-cm5-second-wifi-config` | Second USB Wi-Fi AP setup |
| `etc/hotplug.d/ieee80211/30-cm5-usb-wifi-ap` | USB Wi-Fi AP hotplug |
| `etc/init.d/reload-sdio-wifi` | SDIO Wi-Fi reload |
| `etc/uci-defaults/91-usbmodeswitch-cm5-firstboot` | USB modem modeswitch |
| `etc/hotplug.d/usb/55-usbmodeswitch-cm5` | USB modeswitch hotplug |

## Other init

- `etc/init.d/phy-leds` — PHY LED control
- `etc/hotplug.d/net/40-net-smp-affinity` — IRQ affinity
- `lib/upgrade/platform.sh` — sysupgrade platform hooks

## uci-defaults conventions

- Scripts run **once** on first boot (removed after success)
- Use `board_name` case guard for CM5-only logic
- Prefer `uci commit` only when changes made
- Blocky/DNS defaults may live in openwrt-packages `blocky` package uci-defaults

## Testing after changes

Flash or sysupgrade image, verify:

```sh
uci show network
ip addr show br-lan
board_name
```

LuCI: Network → Interfaces should show `br-lan` on `eth1`/`eth2`, WAN on `eth0`.

See ` build_immortalwrt/docs/FAN_BUTTON_DIAGNOSTICS.md` for fan/button validation.
