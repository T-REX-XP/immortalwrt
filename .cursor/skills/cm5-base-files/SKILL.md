---
name: cm5-base-files
description: >-
  Orange Pi CM5 Base runtime files in ImmortalWrt — board.d network/LEDs/wireless,
  uci-defaults, Wi-Fi scripts, button hotplug, network migration. Use when editing
  target/linux/rockchip/armv8/base-files/ for CM5 first-boot or LAN/DHCP behavior.
---

# CM5 base-files (runtime)

Path: `target/linux/rockchip/armv8/base-files/`

## Network layout (`etc/board.d/02_network`)

For `xunlong,orangepi-cm5-base`:

- **LAN:** `eth1` + `eth2` on `br-lan`, static `192.168.8.1`
- **WAN:** `eth0` (DHCP)
- PCIe paths pinned for stable interface naming:
  - `eth1` → `platform/a41000000.pcie/.../0004:41:00.0`
  - `eth2` → `platform/a40c00000.pcie/.../0003:31:00.0`

MACs: generated from eMMC CID (`mmcblk*`).

## LEDs (`etc/board.d/01_leds` + `etc/uci-defaults/96-cm5-leds`)

| Name | sysfs | Device | Trigger |
|------|-------|--------|---------|
| STATUS | `red:status` | — | heartbeat |
| WAN | `green:wan` | `eth0` | netdev `link` |
| LAN1 | `green:lan-0` | `eth1` | netdev `link` |
| LAN2 | `green:lan-1` | `eth2` | netdev `link` |

PWM WAN/LAN LEDs need DTS `PWM_POLARITY_INVERTED` (patch `9980`); UCI `default=0` = off. Migration marker: `/etc/.cm5_leds_fixed_v5`.

## Wireless country (`etc/board.d/03_wireless_cm5`)

Sets country `US` and 5 GHz MAC count for CM5 only.

## Network migration (`etc/uci-defaults/99-opi-cm5-network-migrate`)

Fixes stale configs after flash/sysupgrade:

- Moves `br-lan` ports from `eth0` → `eth1` + `eth2`
- Sets LAN to `192.168.8.1/24` if still on `192.168.1.1` or `192.168.2.1`
- Ensures `network.wan` on `eth0`
- Runs once; marker: `/etc/.opi_cm5_network_migrated`

Always guard with `[ "$(board_name)" = "xunlong,orangepi-cm5-base" ]`.

## APK feeds (`etc/uci-defaults/97-cm5-apk-feeds`)

Strips `awgopenwrt` / `openwrt_packages` URLs from `/etc/apk/repositories.d/distfeeds.list` (not mirrored on downloads.immortalwrt.org). Those packages are image-baked. Marker: `/etc/.cm5_apk_feeds_fixed_v1`.

## Buttons

GPIO keys are defined in DTS patch `997-*-buttons`. Userspace handlers ship in **openwrt-packages** `cm5-button-scripts` (in `DEVICE_PACKAGES`); handlers call `hotplug-call button` so **luci-app-oled** `99-oled` receives presses. Fork fallback `95-cm5-buttons` was removed.

## Wi-Fi

| File | Role |
|------|------|
| `lib/cm5-base-wifi.sh` | Shared helpers; `cm5_autoconfig_hotspot` prefers 5 GHz AP |
| `etc/uci-defaults/94-cm5-second-wifi-config` | LuCI stub `wireless.cm5_placeholder` until phy appears |
| `etc/hotplug.d/ieee80211/30-cm5-usb-wifi-ap` | USB Wi-Fi AP hotplug |
| `etc/init.d/reload-sdio-wifi` | SDIO Wi-Fi reload + one-shot hotspot |
| `usr/sbin/usbmodeswitch-cm5-run` | Modeswitch boot-loop / hotplug |
| `etc/uci-defaults/91-usbmodeswitch-cm5-firstboot` | Start modeswitch boot-loop |
| `etc/hotplug.d/usb/55-usbmodeswitch-cm5` | USB modeswitch hotplug |
| `usr/libexec/cm5-wifi-benchmark` | MT76x2u AP diagnostics helper |

Hotspot autoconfig runs **once** until `/etc/.cm5_wifi_ap_configured` exists; credentials in `/etc/credentials/cm5-wifi-ap`.

## Other init

- `etc/init.d/phy-leds` — PHY LED control
- `etc/hotplug.d/net/40-net-smp-affinity` — IRQ affinity (CM5 case)
- `lib/upgrade/platform.sh` — sysupgrade platform hooks

## uci-defaults conventions

- Scripts run **once** on first boot (removed after success) **or** use an explicit marker file when they must survive package upgrades
- Use `board_name` case guard for CM5-only logic
- Prefer `uci commit` only when changes made
- Blocky/DNS defaults live in openwrt-packages `blocky` package (`90-blocky-enable` uci-defaults; baked into CM5 image)

## Testing after changes

Flash or sysupgrade image, verify:

```sh
uci show network
ip addr show br-lan
board_name
uci show system | grep led
```

LuCI: Network → Interfaces should show `br-lan` on `eth1`/`eth2`, WAN on `eth0`.

See `Documents/ build_immortalwrt/docs/FAN_BUTTON_DIAGNOSTICS.md` for fan/button validation.
