---
name: rockchip-kernel-dts
description: >-
  Rockchip kernel 6.18 patches and CM5 device tree for ImmortalWrt. Use when editing
  patches-6.18/*cm5*.patch, fan/button/LED/OLED DTS nodes, eMMC boot order, or exporting
  DTS from immortal_opi_cm5/dts-src/.
---

# Rockchip kernel & CM5 DTS

## Kernel version

`target/linux/rockchip/Makefile`:

```makefile
KERNEL_PATCHVER:=6.18
```

Patches directory: `target/linux/rockchip/patches-6.18/`

## CM5 patch series (local)

| Patch | Topic |
|-------|-------|
| `994-01` … `994-03` | CM5 DTS bring-up (Makefile, dtsi, dts) |
| `995-*-openwrt-fan` | PWM fan node (`PWM13`, `pwm13m1_pins`, 20 ms period) |
| `996-*-vbus-startup-delay` | USB VBUS startup timing |
| `997-*-buttons` | GPIO keys / button nodes for hotplug |
| `998-*-fpc-i2c7` | FPC `i2c7` mux for OLED HAT |
| `9980-*-led-polarity` | WAN/LAN netdev LED `PWM_POLARITY_INVERTED` |
| `999-*-oled-rst` | `waveshare-oled-rst` gpio-led on **GPIO1_B4** (FPC pad 9) |
| `9999-*-oled-rst-pinctrl` | FPC I2C SoC pull-ups |

Patch numbering: use next free `99x-` / `999x-` slot in `patches-6.18/`; keep series prefix consistent.

## DTS source workflow

Authoritative DTS edits may live in sibling repo:

```text
immortal_opi_cm5/dts-src/rk3588s-orangepi-cm5-base.dts
immortal_opi_cm5/export/*.patch   → copy to patches-6.18/
```

After exporting, apply patches rebuild kernel:

```sh
make target/linux/clean V=s
make target/linux/compile V=s
# or full image rebuild via Docker wrapper
```

## Fan node (CM5 Base)

Use vendor mapping **PWM13** / `pwm13m1_pins` — not legacy **PWM3**.

Kernel module: `kmod-hwmon-pwmfan` → `pwm_fan` → hwmon name `pwmfan`.

## Buttons

DTS defines GPIO keys consumed by `kmod-button-hotplug` → `/etc/rc.button/*`.

Userspace scripts: `cm5-button-scripts` (openwrt-packages).

## LEDs

WAN/LAN are PWM netdev LEDs; polarity inverted in DTS (`9980`). Userspace names/sysfs mapping: `board.d/01_leds` + `uci-defaults/96-cm5-leds`.

## OLED HAT

- `998`: FPC `i2c7` for panel bus (`/dev/i2c-7`)
- `999` / `9999`: RST gpio + pinctrl pull-ups
- Userspace: `luci-app-oled` / `oledd` (openwrt-packages)

## eMMC

Patch `001-14-*-eMMC-CQE-support-for-rk3588` + CM5 DTS `sdhci` node.

U-Boot tries eMMC before microSD (bootscript + U-Boot patches in `package/boot/uboot-rockchip` if applicable).

## Editing patches

1. Modify `.dts` in kernel tree or regenerate from `dts-src`
2. Refresh patch with `git format-patch` or manual diff
3. Verify patch applies cleanly: `make target/linux/prepare V=s`
4. Rebuild kernel before testing on hardware

## In-tree files (non-patch)

`target/linux/rockchip/files/` — additional kernel sources (drivers, extra DTS for other boards).

Do not duplicate CM5 DTS in `files/` if already maintained via `patches-6.18/994-*`.

## Do not

- Bump `KERNEL_PATCHVER` casually — requires full patch rebasing
- Edit generated files under `build_dir/` — changes are lost on clean
- Break other rockchip boards when changing shared `.dtsi` fragments
