---
name: rockchip-cm5-target
description: >-
  Orange Pi CM5 Base device profile in ImmortalWrt rockchip/armv8 target. Use when
  editing armv8.mk DEVICE_PACKAGES, bootscript, DEFAULT_PROFILE, or adding packages
  to the CM5 firmware image.
---

# Rockchip CM5 target profile

## Identity

| Field | Value |
|-------|-------|
| Device symbol | `xunlong_orangepi-cm5-base` |
| Board name | `xunlong,orangepi-cm5-base` |
| SoC template | `Device/rk3588s` |
| DTS | `rk3588s-orangepi-cm5-base` |
| U-Boot | `orangepi-5-rk3588s` |
| Boot script | `image/orangepi-cm5-base.bootscript` |
| Default profile | `target/linux/rockchip/armv8/target.mk` |

## Primary file

`target/linux/rockchip/image/armv8.mk` — `define Device/xunlong_orangepi-cm5-base`

## DEVICE_PACKAGES groups

When adding packages, append to `DEVICE_PACKAGES` in `armv8.mk`:

- **Hardware:** `kmod-hwmon-pwmfan`, `kmod-r8125`, `kmod-input-adc-keys`, `kmod-button-hotplug`
- **Custom feed:** `blocky`, `luci-app-blocky`, `luci-app-peripherals`, `luci-app-buttons`, `luci-app-oled`, `cm5-button-scripts`, `luci-app-security-guide`, `luci-app-speedtest`
- **Network/VPN:** WireGuard, AmneziaWG, Tailscale, PBR, fwknopd, …
- **Services:** SQM, watchcat, privoxy, ksmbd, minidlna, statistics, nlbwmon (no Docker, travelmate, transmission, aria2)
- **Wi-Fi USB:** `kmod-mt76x2u`, `kmod-rtl8812au-ct`, `wpad-openssl`, `hostapd-utils`

Recipes live in **openwrt-packages** or ImmortalWrt feeds — this tree only lists them in `DEVICE_PACKAGES`.

## Image output

```text
bin/targets/rockchip/armv8/
  immortalwrt-rockchip-armv8-xunlong_orangepi-cm5-base-ext4-sysupgrade.img.gz
  immortalwrt-rockchip-armv8-xunlong_orangepi-cm5-base-squashfs-sysupgrade.img.gz
```

## eMMC + microSD

DTS enables eMMC (`sdhci`); U-Boot prefers eMMC. Same image for both media.

## Manifest verification

Use `IMMORTALWRT_EXPECT_PACKAGES` in macOS build (see ` build_immortalwrt` README).

## After DEVICE_PACKAGES change

1. Rebuild image (not just single package if new to profile)
2. Verify manifest lists new packages
3. Custom feed packages need `openwrt_packages` feed at build time

## Do not

- Put LuCI/package Makefiles in `target/linux/rockchip/` — use openwrt-packages feed
- Change `DEFAULT_PROFILE` without confirming other armv8 boards still build in CI
